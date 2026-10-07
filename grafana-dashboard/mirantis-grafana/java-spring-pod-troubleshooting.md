---
title: Java / Spring Boot pod troubleshooting
description: First-pass triage of Java and Spring Boot pods on OpenShift — requests vs limits, CFS throttling, JVM heap and GC, actuator probes, 10 targeted PromQL queries and a one-shot triage script.
---

Scope: a Java / Spring Boot pod that restarts, fails probes, times out or dies with `OutOfMemoryError`.
Goal: in 5 minutes, decide whether it is **CPU (throttling)**, **container memory (OOMKilled)**, **Java heap (heap OOM / GC thrashing)** or **probes**.

:::tip[One shot]
`jvm-triage.sh -n <ns> -p <pod>` runs every check on this page and prints a findings list. See [Triage script](#triage-script).
:::

## Set once

Every command below uses these variables.

```bash
NS=<namespace>
POD=<pod>
C=$(oc -n $NS get pod $POD -o jsonpath='{.spec.containers[0].name}')
JPID=1   # Java PID in the container; confirm with: oc -n $NS exec $POD -c $C -- jcmd -l
```

## First diagnosis

### Last exit code

```bash
oc -n $NS get pod $POD -o jsonpath='{range .status.containerStatuses[*]}{.name}{"  restarts="}{.restartCount}{"  last="}{.lastState.terminated.reason}{"/"}{.lastState.terminated.exitCode}{"  at "}{.lastState.terminated.finishedAt}{"\n"}{end}'
```

| Exit | Reason | Meaning | Where to look |
|---|---|---|---|
| **137** | `OOMKilled` | Kernel killed the container: **heap + non-heap > memory limit** | `MaxRAMPercentage`, non-heap headroom, memory limit |
| **137** | `Error` | SIGKILL without OOM: liveness kill after grace period, eviction | Events, probes |
| **143** | `Error` | SIGTERM: liveness failure, rollout, eviction | Events, probes |
| **3** | `Error` | `-XX:+ExitOnOutOfMemoryError`: **Java heap exhausted**, container limit not reached | Heap sizing, heap dump, GC |
| **1** | `Error` | Application error (startup, config, dependency) | `logs --previous` |

### Symptom → cause

| Symptom | Check | Likely cause | Action |
|---|---|---|---|
| Probe `context deadline exceeded` | Throttling %, GC time % | CPU limit too low, GC pauses | CPU limit ≥ 1 core, probe timeout 3–5s |
| Exit 137 `OOMKilled` | Max heap % of limit, non-heap headroom | Heap sized too close to the limit | `MaxRAMPercentage` 70–75, or raise the limit |
| Exit 3 / `Java heap space` | Heap % max, old gen, GC time | Heap too small for the workload, or a leak | Heap dump, raise limit, escalate to the app team |
| Slow startup, killed during boot | Throttling during startup | CPU limit + no `startupProbe` | `startupProbe`, higher CPU limit |
| Restarts when DB is down | Liveness path | Liveness on `/actuator/health` (aggregate) | Liveness on `/actuator/health/liveness` |
| Batch/executor timeouts | Throttling + thread states | Worker threads starved of CPU | CPU limit, bounded executor (app) |

### Sizing rules of thumb

| Item | Baseline |
|---|---|
| CPU limit | **≥ 1 core** for Spring Boot. Under 500m, startup, JIT and GC get throttled. Request can stay lower. |
| Memory | request = limit (Guaranteed memory, no eviction surprises) |
| `MaxRAMPercentage` | **70–75**. At 80 or more, non-heap has too little room. |
| Non-heap headroom | **≥ 256–384 MiB** (limit − max heap). Covers metaspace, thread stacks, code cache and direct buffers. |
| Liveness | `/actuator/health/liveness`, `timeoutSeconds` 3–5, plus a `startupProbe` |
| OOM flags | `-XX:+ExitOnOutOfMemoryError -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps` on a volume |

## Commands

### Requests, limits and probes

```bash
oc -n $NS get pod $POD -o jsonpath='{range .spec.containers[*]}{.name}{"\n  requests: "}{.resources.requests}{"\n  limits:   "}{.resources.limits}{"\n  liveness: "}{.livenessProbe.httpGet.path}{" timeout="}{.livenessProbe.timeoutSeconds}{"s period="}{.livenessProbe.periodSeconds}{"s failures="}{.livenessProbe.failureThreshold}{" delay="}{.livenessProbe.initialDelaySeconds}{"s\n  readiness: "}{.readinessProbe.httpGet.path}{" timeout="}{.readinessProbe.timeoutSeconds}{"s\n  startup:  "}{.startupProbe.httpGet.path}{"\n"}{end}'
```

### Live usage

```bash
oc adm top pod $POD -n $NS --containers
```

### CPU throttling (cgroup v2, from inside the container)

Lifetime of the container:

```bash
oc -n $NS exec $POD -c $C -- cat /sys/fs/cgroup/cpu.stat | awk '/^nr_periods/{p=$2} /^nr_throttled/{t=$2} /^throttled_usec/{s=$2} /^usage_usec/{u=$2} END{printf "throttled %.0f%% of periods | stalled %.0fs vs %.0fs CPU used\n", 100*t/p, s/1e6, u/1e6}'
```

Right now (10 second sample):

```bash
oc -n $NS exec $POD -c $C -- sh -c 'grep -E "^nr_(periods|throttled)" /sys/fs/cgroup/cpu.stat; sleep 10; grep -E "^nr_(periods|throttled)" /sys/fs/cgroup/cpu.stat' | awk '{v[NR]=$2} END{d=v[3]-v[1]; if (d>0) printf "throttled last 10s: %.0f%% (%d/%d)\n", 100*(v[4]-v[2])/d, v[4]-v[2], d; else print "idle"}'
```

### Container memory and OOM kills

```bash
oc -n $NS exec $POD -c $C -- sh -c 'cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.max; grep oom_kill /sys/fs/cgroup/memory.events' | awk 'NR==1{c=$1} NR==2{m=$1} NR==3{k=$2} END{ if (m=="max") printf "%.0f MiB / unlimited | oom_kill=%d\n", c/1048576, k; else printf "%.0f / %.0f MiB (%.0f%%) | oom_kill=%d\n", c/1048576, m/1048576, 100*c/m, k }'
```

`memory.current` includes page cache, so it runs higher than `container_memory_working_set_bytes`.

:::note[cgroup v1]
Use `/sys/fs/cgroup/cpu,cpuacct/cpu.stat` (`throttled_time` is in ns) and `/sys/fs/cgroup/memory/memory.usage_in_bytes`, `memory.limit_in_bytes`.
:::

### JVM options in effect

Heap, GC and OOM flags:

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID VM.flags | tr ' ' '\n' | grep -E 'MaxHeapSize|MaxRAMPercentage|Use[A-Za-z]*GC$|OnOutOfMemory|HeapDump|ActiveProcessorCount' | awk -F= '/MaxHeapSize/{printf "MaxHeapSize = %d MiB\n", $2/1048576; next} 1'
```

Options from env and command line:

```bash
oc -n $NS set env pod/$POD --list | grep -E 'JAVA|JDK|XMX|RAM|GC'
```

```bash
oc -n $NS exec $POD -c $C -- sh -c "tr '\0' ' ' < /proc/$JPID/cmdline; echo"
```

### Heap and GC

Snapshot in MiB:

```bash
oc -n $NS exec $POD -c $C -- jstat -gc $JPID | awk 'NR==1{for(i=1;i<=NF;i++)h[$i]=i; next} {printf "heap used %.0f / committed %.0f MiB | old %.0f / %.0f MiB | metaspace %.0f MiB | young=%s full=%s | GC total %.1fs\n", ($h["S0U"]+$h["S1U"]+$h["EU"]+$h["OU"])/1024, ($h["S0C"]+$h["S1C"]+$h["EC"]+$h["OC"])/1024, $h["OU"]/1024, $h["OC"]/1024, $h["MU"]/1024, $h["YGC"], $h["FGC"], $h["GCT"]}'
```

GC time as a percentage of uptime (above 10% means thrashing):

```bash
oc -n $NS exec $POD -c $C -- sh -c "jcmd $JPID VM.uptime | tail -1; jstat -gcutil $JPID | tail -1" | awk 'NR==1{u=$1} NR==2{printf "GC time %.1f%% of uptime (%.0fs / %.0fs)\n", 100*$NF/u, $NF, u}'
```

Trend: 1 minute, 5 second step. `O` is old gen %, `FGC`/`FGCT` are full GC count and time.

```bash
oc -n $NS exec $POD -c $C -- jstat -gcutil $JPID 5000 12
```

Heap by generation, as reported by the GC:

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID GC.heap_info
```

### Threads

Count:

```bash
oc -n $NS exec $POD -c $C -- sh -c "ls /proc/$JPID/task | wc -l"
```

States (many `BLOCKED` or `WAITING` point to lock or pool starvation):

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID Thread.print | grep -oE 'State: [A-Z_]+' | sort | uniq -c | sort -rn
```

Threads per pool (an unbounded executor shows up here):

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID Thread.print | grep -E '^"' | sed -E 's/^"([^"]*)".*/\1/; s/[-#]?[0-9]+$//' | sort | uniq -c | sort -rn | head -15
```

Full dump to a local file:

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID Thread.print > threads-$POD-$(date +%H%M%S).txt
```

### Memory content

Top classes by retained size:

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID GC.class_histogram | head -25
```

:::caution
`GC.class_histogram` triggers a full GC. With a low CPU limit that pause can fail the probes.
:::

Native memory, only if the JVM was started with `-XX:NativeMemoryTracking=summary`:

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID VM.native_memory summary scale=MB
```

Heap dump on demand, then copy it out and delete it from the pod:

```bash
oc -n $NS exec $POD -c $C -- jcmd $JPID GC.heap_dump /tmp/heap.hprof
```

```bash
oc -n $NS cp -c $C $POD:/tmp/heap.hprof ./heap-$POD.hprof
```

```bash
oc -n $NS exec $POD -c $C -- rm -f /tmp/heap.hprof
```

:::danger[Production]
A heap dump stops the JVM for seconds to minutes and writes a file about the size of the used heap. It can trigger a liveness kill or fill ephemeral storage. The preferred approach is `-XX:+HeapDumpOnOutOfMemoryError` with `HeapDumpPath` on a volume.
:::

### Actuator from inside the pod

Response time vs the probe timeout:

```bash
oc -n $NS exec $POD -c $C -- curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}s\n' http://localhost:8080/actuator/health/liveness
```

```bash
oc -n $NS exec $POD -c $C -- curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}s\n' http://localhost:8080/actuator/health/readiness
```

Are JVM metrics exposed (non-zero = yes)?

```bash
oc -n $NS exec $POD -c $C -- curl -s http://localhost:8080/actuator/prometheus | grep -c '^jvm_'
```

Are they scraped?

```bash
oc -n $NS get servicemonitor,podmonitor
```

### Logs and events

```bash
oc -n $NS logs $POD -c $C --previous | grep -E 'OutOfMemory|Terminating|Timeout|Exception|Caused by' | tail -30
```

```bash
oc -n $NS get events --field-selector involvedObject.name=$POD --sort-by=.lastTimestamp | tail -15
```

### Node

```bash
oc adm top node $(oc -n $NS get pod $POD -o jsonpath='{.spec.nodeName}')
```

```bash
oc get node $(oc -n $NS get pod $POD -o jsonpath='{.spec.nodeName}') -o jsonpath='{range .status.conditions[*]}{.type}={.status}{"  "}{end}{"\n"}'
```

:::note[No jcmd / jstat in the image]
JRE-only or distroless images have no JDK tools. Options: use the JVM PromQL queries below, or attach an ephemeral debug container with a JDK image from the internal mirror.

```bash
kubectl -n $NS debug -it $POD --image=<mirror>/ubi9/openjdk-17 --target=$C -- bash
```

`jcmd` attach across containers needs the same UID and a shared `/tmp`, so this does not always work.
:::

## PromQL — 10 queries

Replace `<ns>`, `<pod>` and `<container>`. `pod=~"<pod>.*"` covers every replica of the workload. Queries 7–10 require `/actuator/prometheus` (Micrometer), User Workload Monitoring and a ServiceMonitor.

| # | Query | Unit | Healthy | Problem |
|---|---|---|---|---|
| 1 | CPU vs limit | % | < 70 | ~100 during batch or startup |
| 2 | CPU vs request | % | ≤ 100 | ≫ 100 steadily: request underestimated |
| 3 | CPU throttling | % | < 10 | > 25 |
| 4 | Memory vs limit | % | stable | climbing to 100 → OOMKilled |
| 5 | Restarts (24h) | count | 0 | > 0 |
| 6 | Last termination reason | label | — | `OOMKilled` / `Error` |
| 7 | Heap vs max | % | sawtooth < 70 | stuck > 85 |
| 8 | Old gen vs max | % | drops after full GC | floor keeps rising → leak |
| 9 | GC time | % | < 5 | > 10 → thrashing |
| 10 | Max GC pause | s | < 1 | ≥ probe timeout |

**1. CPU % of limit**
```text
100 * sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="<ns>",pod=~"<pod>.*",container="<container>"}[5m]))
/ sum by (pod) (kube_pod_container_resource_limits{namespace="<ns>",pod=~"<pod>.*",container="<container>",resource="cpu"})
```

**2. CPU % of request**
```text
100 * sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="<ns>",pod=~"<pod>.*",container="<container>"}[5m]))
/ sum by (pod) (kube_pod_container_resource_requests{namespace="<ns>",pod=~"<pod>.*",container="<container>",resource="cpu"})
```

**3. CPU throttling %**
```text
100 * sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{namespace="<ns>",pod=~"<pod>.*",container="<container>"}[5m]))
/ sum by (pod) (rate(container_cpu_cfs_periods_total{namespace="<ns>",pod=~"<pod>.*",container="<container>"}[5m]))
```

**4. Memory % of limit**
```text
100 * sum by (pod) (container_memory_working_set_bytes{namespace="<ns>",pod=~"<pod>.*",container="<container>"})
/ sum by (pod) (kube_pod_container_resource_limits{namespace="<ns>",pod=~"<pod>.*",container="<container>",resource="memory"})
```

**5. Restarts in the last 24h**
```text
sum by (pod) (increase(kube_pod_container_status_restarts_total{namespace="<ns>",pod=~"<pod>.*",container="<container>"}[24h]))
```

**6. Last termination reason**
```text
max by (pod, reason) (kube_pod_container_status_last_terminated_reason{namespace="<ns>",pod=~"<pod>.*",container="<container>"}) == 1
```

**7. Heap % of max**
```text
100 * sum by (pod) (jvm_memory_used_bytes{namespace="<ns>",pod=~"<pod>.*",area="heap"})
/ sum by (pod) (jvm_memory_max_bytes{namespace="<ns>",pod=~"<pod>.*",area="heap"})
```

**8. Old gen % of max**
```text
100 * sum by (pod) (jvm_memory_used_bytes{namespace="<ns>",pod=~"<pod>.*",id=~".*(Old Gen|Tenured).*"})
/ sum by (pod) (jvm_memory_max_bytes{namespace="<ns>",pod=~"<pod>.*",id=~".*(Old Gen|Tenured).*"})
```

**9. GC time % of wall clock**
```text
100 * sum by (pod) (rate(jvm_gc_pause_seconds_sum{namespace="<ns>",pod=~"<pod>.*"}[5m]))
```

**10. Max GC pause (s)**
```text
max by (pod) (jvm_gc_pause_seconds_max{namespace="<ns>",pod=~"<pod>.*"})
```

:::tip[How to read them together]
Overlay 3 and 9 with the probe failure times. Throttling and GC time rising together, followed by probe failures, means a **CPU-bound** problem. Heap flat at max with a rising old-gen floor means **heap sizing or a leak**.
:::

## Triage script

[`jvm-triage.sh`](/scripts/jvm-triage.sh) is read-only. It runs `get`, `adm top` and `exec` (cgroup files, `jcmd`, `jstat`, `curl`) and changes nothing.

```bash
chmod +x jvm-triage.sh
./jvm-triage.sh -n <ns> -p <pod>                     # first container, 10s throttling sample
./jvm-triage.sh -n <ns> -p <pod> -c <container> -s 30
CLI=kubectl ./jvm-triage.sh -n <ns> -p <pod>         # plain Kubernetes
```

| Section | What it checks |
|---|---|
| 1. Pod status | Restarts, last exit code with its interpretation (137 / 143 / 3 / 1) |
| 2. Resources | Request vs limit vs live usage for CPU and memory, as % of request and of limit |
| 3. Probes | Path, timeout, failure window, missing `startupProbe`, liveness on the aggregate health endpoint |
| 4. cgroup | Throttling % over the container lifetime and over a live sample, stalled vs used CPU seconds, memory, `oom_kill` |
| 5. JVM | GC, max heap as % of the limit, non-heap headroom, heap and old gen, GC time %, average full-GC pause vs probe timeout, OOM flags, JVM env |
| 6. Actuator | Liveness and readiness response time vs the timeout, `/actuator/prometheus` exposure and ServiceMonitor |
| 7. Events | Warning events and the total count of probe failures |
| 8. Node | Node CPU and memory, conditions other than `Ready` |
| Findings | `CRIT` / `WARN` / `INFO` list, followed by the next commands to run |

Requirements: bash 4.4+ and `awk` on the bastion; `/bin/sh` in the image. `jcmd`, `jstat` and `curl` in the image are optional, and the matching sections are skipped when a tool is missing.

### Full script

Copy-paste version for air-gapped bastions. Save it as `jvm-triage.sh`, then `chmod +x`.

<details>
<summary>Show <code>jvm-triage.sh</code></summary>

```bash
#!/usr/bin/env bash
# jvm-triage.sh — first-pass triage of a Java / Spring Boot pod on OpenShift or Kubernetes
#
# Usage: jvm-triage.sh -n <namespace> -p <pod> [-c <container>] [-s <seconds>]
#   -n  namespace
#   -p  pod name
#   -c  container (default: first container in the pod spec)
#   -s  live CPU-throttling sample window in seconds (default: 10)
#   CLI=kubectl jvm-triage.sh ...   to use kubectl instead of oc
#
# Read-only: get, adm top, exec (cgroup files, jcmd, jstat, curl). Nothing is changed.
# Bastion: bash 4.4+ and awk. Image: /bin/sh required; jcmd, jstat, curl optional.

set -uo pipefail

CLI="${CLI:-oc}"
NS="" POD="" CTR="" SAMPLE=10

usage() { sed -n '4,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
while getopts ":n:p:c:s:h" o; do
  case "$o" in
    n) NS=$OPTARG ;;
    p) POD=$OPTARG ;;
    c) CTR=$OPTARG ;;
    s) SAMPLE=$OPTARG ;;
    *) usage ;;
  esac
done
[[ -z $NS || -z $POD ]] && usage
[[ $SAMPLE =~ ^[0-9]+$ ]] || usage

if [[ -t 1 ]]; then
  R=$'\e[31m' Y=$'\e[33m' G=$'\e[32m' C=$'\e[36m' B=$'\e[1m' D=$'\e[2m' N=$'\e[0m'
else
  R='' Y='' G='' C='' B='' D='' N=''
fi
if [[ ${CLI##*/} == oc ]]; then TOP=("$CLI" adm top); else TOP=("$CLI" top); fi

# ---------------------------------------------------------------- helpers
FIND=()
crit() { FIND+=("CRIT|$*"); }
warn() { FIND+=("WARN|$*"); }
info() { FIND+=("INFO|$*"); }
hdr()  { printf '\n%s%s▌ %s%s\n' "$B" "$C" "$1" "$N"; }
kv()   { printf '  %-22s %s\n' "$1" "$2"; }
k()    { "$CLI" -n "$NS" "$@"; }
jp()   { k get pod "$POD" -o jsonpath="$1" 2>/dev/null; }
kx()   { k exec -i "$POD" -c "$CTR" -- sh -s -- "$@" 2>/dev/null; }

to_m() {   # CPU quantity -> millicores (empty in -> empty out)
  local v=${1:-}; [[ -z $v ]] && return
  if [[ $v == *m ]]; then echo "${v%m}"; else awk -v x="$v" 'BEGIN{printf "%d", x*1000}'; fi
}
to_mi() {  # memory quantity -> MiB (empty in -> empty out)
  local v=${1:-}; [[ -z $v ]] && return
  awk -v x="$v" 'BEGIN{ n=x+0; u=x; sub(/^[0-9.]+/, "", u); f=1/1048576
    if (u=="Ki") f=1/1024; else if (u=="Mi") f=1; else if (u=="Gi") f=1024; else if (u=="Ti") f=1048576
    else if (u=="k"||u=="K") f=1e3/1048576; else if (u=="M") f=1e6/1048576; else if (u=="G") f=1e9/1048576
    printf "%d", n*f }'
}
pct()  { awk -v a="${1:-}" -v b="${2:-}" 'BEGIN{ if (a!="" && b+0>0) printf "%.0f", 100*a/b; else printf "-" }'; }
pctf() { local p; p=$(pct "$@"); [[ $p == - ]] && echo "-" || echo "$p%"; }
gt()   { awk -v a="${1:-}" -v b="$2" 'BEGIN{ exit !(a!="" && a!="-" && a+0>b+0) }'; }
fmt()  { [[ -n ${1:-} ]] && echo "$1$2" || echo "-"; }

# ---------------------------------------------------------------- 1. status
PHASE=$(jp '{.status.phase}')
[[ -z $PHASE ]] && { echo "${R}pod $NS/$POD not found or not readable${N}"; exit 2; }
[[ -z $CTR ]] && CTR=$(jp '{.spec.containers[0].name}')
CS="{.status.containerStatuses[?(@.name==\"$CTR\")]"
SP="{.spec.containers[?(@.name==\"$CTR\")]"

hdr "1. Pod status"
NODE=$(jp '{.spec.nodeName}');   QOS=$(jp '{.status.qosClass}')
RESTARTS=$(jp "$CS.restartCount}"); READY=$(jp "$CS.ready}")
STARTED=$(jp "$CS.state.running.startedAt}")
LREASON=$(jp "$CS.lastState.terminated.reason}"); LEXIT=$(jp "$CS.lastState.terminated.exitCode}")
LFIN=$(jp "$CS.lastState.terminated.finishedAt}")
kv "pod" "$POD  ($PHASE, ready=${READY:-?}, qos=${QOS:-?})"
kv "container" "$CTR"
kv "node" "${NODE:--}"
kv "restarts" "${RESTARTS:-0}   running since ${STARTED:--}"
kv "last termination" "${LREASON:--}  exit=${LEXIT:--}  at ${LFIN:--}"
case "${LEXIT:-}" in
  "")  ;;
  137) if [[ $LREASON == OOMKilled ]]; then
         crit "exit 137 OOMKilled: container exceeded its MEMORY LIMIT (kernel kill). Heap + non-heap > limit → lower MaxRAMPercentage or raise the limit"
       else
         warn "exit 137 (SIGKILL, not OOM): liveness kill or eviction → check events"
       fi ;;
  143) warn "exit 143 (SIGTERM): liveness failure, rollout or eviction → check events" ;;
  3)   crit "exit 3: JVM -XX:+ExitOnOutOfMemoryError → Java HEAP exhausted (not the container limit) → heap dump / heap sizing" ;;
  1)   warn "exit 1: application error → logs --previous" ;;
  *)   warn "last exit code $LEXIT ($LREASON) → logs --previous" ;;
esac

# ---------------------------------------------------------------- 2. resources
hdr "2. Requests / limits vs live usage"
RQC=$(jp "$SP.resources.requests.cpu}");    LMC=$(jp "$SP.resources.limits.cpu}")
RQM=$(jp "$SP.resources.requests.memory}"); LMM=$(jp "$SP.resources.limits.memory}")
UC='' UM=''
read -r UC UM < <("${TOP[@]}" pod "$POD" -n "$NS" --containers --no-headers 2>/dev/null | awk -v c="$CTR" '$2==c{print $3, $4}')
RQC_M=$(to_m "$RQC");   LMC_M=$(to_m "$LMC");   UC_M=$(to_m "$UC")
RQM_MI=$(to_mi "$RQM"); LMM_MI=$(to_mi "$LMM"); UM_MI=$(to_mi "$UM")

row() { printf '  %-8s %10s %10s %10s %7s %7s\n' "$@"; }
row "" "request" "limit" "used" "%req" "%lim"
row "cpu"    "$(fmt "$RQC_M" m)"   "$(fmt "$LMC_M" m)"   "$(fmt "$UC_M" m)"   "$(pctf "$UC_M" "$RQC_M")" "$(pctf "$UC_M" "$LMC_M")"
row "memory" "$(fmt "$RQM_MI" Mi)" "$(fmt "$LMM_MI" Mi)" "$(fmt "$UM_MI" Mi)" "$(pctf "$UM_MI" "$RQM_MI")" "$(pctf "$UM_MI" "$LMM_MI")"
[[ -z $UC ]] && printf '  %s(live usage unavailable: metrics API not reachable)%s\n' "$D" "$N"

if [[ -z $LMC_M ]]; then
  info "no CPU limit → no CFS throttling (the pod can burst on free node CPU)"
elif (( LMC_M < 500 )); then
  warn "CPU limit ${LMC_M}m is low for Spring Boot (startup, JIT and GC need bursts) → expect throttling; ≥ 1 core limit is a sane baseline"
fi
[[ -z $LMM_MI ]] && warn "no memory limit → the JVM sizes its heap on NODE memory → risk of node pressure and eviction"
[[ -n $RQM_MI && -n $LMM_MI && $RQM_MI != "$LMM_MI" ]] && info "memory request ${RQM_MI}Mi ≠ limit ${LMM_MI}Mi → Burstable, evictable under node memory pressure"
gt "$(pct "$UC_M" "$LMC_M")" 90 && warn "CPU at $(pctf "$UC_M" "$LMC_M") of limit right now"
gt "$(pct "$UM_MI" "$LMM_MI")" 90 && warn "memory at $(pctf "$UM_MI" "$LMM_MI") of limit right now"

# ---------------------------------------------------------------- 3. probes
hdr "3. Probes"
LTO=1 LDL=0 LPATH="" RPATH="" PORT=""
for P in startup liveness readiness; do
  if [[ -z $(jp "$SP.${P}Probe}") ]]; then kv "$P" "none"; continue; fi
  path=$(jp "$SP.${P}Probe.httpGet.path}");      port=$(jp "$SP.${P}Probe.httpGet.port}")
  to=$(jp "$SP.${P}Probe.timeoutSeconds}");       to=${to:-1}
  per=$(jp "$SP.${P}Probe.periodSeconds}");       per=${per:-10}
  ft=$(jp "$SP.${P}Probe.failureThreshold}");     ft=${ft:-3}
  dl=$(jp "$SP.${P}Probe.initialDelaySeconds}");  dl=${dl:-0}
  kv "$P" "${path:-exec/tcp}${port:+ :$port}  timeout=${to}s period=${per}s failures=${ft} delay=${dl}s  ${D}→ acts after $((per*ft))s of failures${N}"
  case $P in
    liveness)  LTO=$to LDL=$dl LPATH=$path; PORT=${PORT:-$port} ;;
    readiness) RPATH=$path; PORT=${PORT:-$port} ;;
  esac
done
if [[ -n $PORT && ! $PORT =~ ^[0-9]+$ ]]; then PORT=$(jp "$SP.ports[?(@.name==\"$PORT\")].containerPort}"); fi
PORT=${PORT:-8080}

HAS_STARTUP=$(jp "$SP.startupProbe}")
if [[ -n $(jp "$SP.livenessProbe}") ]]; then
  (( LTO <= 1 )) && warn "liveness timeoutSeconds=${LTO}s: one GC pause or throttled period fails it → use 3-5s"
  [[ -z $HAS_STARTUP ]] && (( LDL < 60 )) && warn "no startupProbe and liveness delay ${LDL}s: slow (throttled) startups get killed → add a startupProbe"
  [[ $LPATH == /actuator/health ]] && warn "liveness on /actuator/health aggregates DB/downstream checks → restarts on dependency outage; use /actuator/health/liveness"
  [[ -n $LPATH && $LPATH == "$RPATH" ]] && info "liveness and readiness hit the same endpoint"
else
  warn "no liveness probe"
fi

# ---------------------------------------------------------------- 4. cgroup
hdr "4. cgroup — CPU throttling & memory (live sample ${SAMPLE}s)"
CG=$(kx "$SAMPLE" <<'EOF'
if [ -f /sys/fs/cgroup/cpu.stat ]; then
  echo "cgv 2"; S=/sys/fs/cgroup/cpu.stat
  echo "mem_cur $(cat /sys/fs/cgroup/memory.current)"
  echo "mem_max $(cat /sys/fs/cgroup/memory.max)"
  while read -r k v; do [ "$k" = oom_kill ] && echo "oom_kill $v"; done < /sys/fs/cgroup/memory.events
else
  echo "cgv 1"; S=/sys/fs/cgroup/cpu,cpuacct/cpu.stat; [ -f "$S" ] || S=/sys/fs/cgroup/cpu/cpu.stat
  echo "mem_cur $(cat /sys/fs/cgroup/memory/memory.usage_in_bytes)"
  echo "mem_max $(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"
  while read -r k v; do [ "$k" = oom_kill ] && echo "oom_kill $v"; done < /sys/fs/cgroup/memory/memory.oom_control
fi
while read -r k v; do echo "a_$k $v"; done < "$S"
sleep "$1"
while read -r k v; do echo "b_$k $v"; done < "$S"
EOF
)
declare -A CGV=()
while read -r a b; do [[ -n ${a:-} ]] && CGV[$a]=$b; done <<< "$CG"
if [[ -z ${CGV[cgv]:-} ]]; then
  kv "cgroup" "unreadable (exec denied or no /bin/sh in image)"
  warn "cannot exec into the container → use the PromQL queries for throttling/memory"
else
  per_a=${CGV[a_nr_periods]:-0} per_b=${CGV[b_nr_periods]:-0} thr_a=${CGV[a_nr_throttled]:-0} thr_b=${CGV[b_nr_throttled]:-0}
  if [[ ${CGV[cgv]} == 2 ]]; then
    stall=$(awk -v x="${CGV[b_throttled_usec]:-0}" 'BEGIN{printf "%.0f", x/1e6}')
    used=$(awk -v x="${CGV[b_usage_usec]:-0}" 'BEGIN{printf "%.0f", x/1e6}')
  else
    stall=$(awk -v x="${CGV[b_throttled_time]:-0}" 'BEGIN{printf "%.0f", x/1e9}'); used=""
  fi
  THR_ALL=$(pct "$thr_b" "$per_b")
  THR_LIVE=$(pct $((thr_b - thr_a)) $((per_b - per_a)))
  kv "cgroup" "v${CGV[cgv]}"
  kv "throttled (lifetime)" "${THR_ALL}% of periods ($thr_b/$per_b) — stalled ${stall}s${used:+ vs ${used}s of CPU used}"
  if (( per_b > per_a )); then
    kv "throttled (last ${SAMPLE}s)" "${THR_LIVE}% ($((thr_b - thr_a))/$((per_b - per_a)))"
  else
    THR_LIVE="-"; kv "throttled (last ${SAMPLE}s)" "idle (no runnable periods)"
  fi

  mc=${CGV[mem_cur]:-0} mm=${CGV[mem_max]:-max} MM_MI=""
  MC_MI=$(( mc / 1048576 ))
  if [[ $mm == max ]] || (( mm > 4611686018427387904 )); then mmtxt="unlimited"; else MM_MI=$(( mm / 1048576 )); mmtxt="${MM_MI} MiB ($(pctf "$MC_MI" "$MM_MI"))"; fi
  kv "memory (cgroup)" "${MC_MI} MiB / ${mmtxt}  ${D}incl. page cache${N}"
  kv "oom_kill events" "${CGV[oom_kill]:-0}"

  if gt "$THR_ALL" 50; then
    crit "CPU throttled in ${THR_ALL}% of periods since start (stalled ${stall}s${used:+ vs ${used}s used}) → raise the CPU limit"
  elif gt "$THR_ALL" 20; then
    warn "CPU throttled in ${THR_ALL}% of periods since start → CPU limit too tight"
  fi
  gt "$THR_LIVE" 20 && warn "throttling right now: ${THR_LIVE}% over the last ${SAMPLE}s"
  gt "${CGV[oom_kill]:-0}" 0 && crit "kernel OOM kills in this cgroup: ${CGV[oom_kill]} → container memory limit exceeded"
fi

# ---------------------------------------------------------------- 5. JVM
hdr "5. JVM"
JV=$(kx <<'EOF'
PID=1
if command -v jcmd >/dev/null 2>&1; then
  P=$(jcmd -l 2>/dev/null | while read -r p n; do case "$n" in *JCmd*) ;; *) echo "$p"; break ;; esac; done)
  [ -n "$P" ] && PID=$P
fi
echo "@@PID $PID"
echo "@@THREADS $(ls /proc/$PID/task 2>/dev/null | wc -l)"
echo "@@TOOLS $(command -v jcmd >/dev/null 2>&1 && echo jcmd) $(command -v jstat >/dev/null 2>&1 && echo jstat)"
echo "@@CMDLINE"; tr '\0' ' ' < /proc/$PID/cmdline 2>/dev/null; echo
echo "@@ENV"; env | grep -E '^(JAVA|JDK_JAVA|_JAVA|GC_)' 2>/dev/null
if command -v jcmd >/dev/null 2>&1; then
  echo "@@VERSION"; jcmd $PID VM.version 2>/dev/null | sed -n '2p'
  echo "@@UPTIME";  jcmd $PID VM.uptime 2>/dev/null | tail -1
  echo "@@FLAGS";   jcmd $PID VM.flags 2>/dev/null | tail -1
fi
if command -v jstat >/dev/null 2>&1; then
  echo "@@GC"; jstat -gc $PID 2>/dev/null
fi
echo "@@END"
EOF
)
sect() { awk -v s="@@$1" '$1==s { f=1; sub("^" s " ?", ""); if ($0 != "") print; next } /^@@/ { f=0 } f' <<< "$JV"; }

JPID=1
if [[ -z $JV ]]; then
  kv "jvm" "exec failed"
else
  JPID=$(sect PID); THREADS=$(sect THREADS); TOOLS=$(sect TOOLS)
  FLAGS=$(sect FLAGS); CMDL=$(sect CMDLINE); JENV=$(sect ENV)
  if [[ -z $FLAGS ]] && ! grep -q java <<< "$CMDL"; then
    kv "jvm" "no java process found (pid $JPID: ${CMDL:0:60})"
  else
    ALL="$FLAGS $CMDL $JENV"
    flagval() { grep -oE -- "-XX:$1=[^ ]+" <<< "$ALL" | tail -1 | cut -d= -f2; }
    hasflag() { grep -qE -- "-XX:\+$1( |$)" <<< "$ALL"; }

    MAXHEAP_MI=""
    mh=$(flagval MaxHeapSize); [[ -n $mh ]] && MAXHEAP_MI=$(( mh / 1048576 ))
    if [[ -z $MAXHEAP_MI ]]; then
      xmx=$(grep -oE -- '-Xmx[0-9]+[kKmMgG]?' <<< "$ALL" | tail -1)
      [[ -n $xmx ]] && MAXHEAP_MI=$(to_mi "$(sed -E 's/-Xmx//; s/[gG]$/Gi/; s/[mM]$/Mi/; s/[kK]$/Ki/' <<< "$xmx")")
    fi
    RAMPCT=$(flagval MaxRAMPercentage)
    GCNAME=""; for g in G1 Parallel Serial Z Shenandoah; do hasflag "Use${g}GC" && { GCNAME=$g; break; }; done
    UPT=$(sect UPTIME | awk '{print $1+0}')

    H_U='' H_C='' O_U='' O_C='' M_U='' GCT_S='' FGC_N='' FGCT_S='' YGC_N=''
    read -r H_U H_C O_U O_C M_U GCT_S FGC_N FGCT_S YGC_N <<< "$(awk '
      function c(n) { return (n in h && $h[n] != "-") ? $h[n] : 0 }
      NR==1 { for (i=1; i<=NF; i++) h[$i]=i; next }
      NR==2 { printf "%.0f %.0f %.0f %.0f %.0f %s %s %s %s",
                (c("S0U")+c("S1U")+c("EU")+c("OU"))/1024, (c("S0C")+c("S1C")+c("EC")+c("OC"))/1024,
                c("OU")/1024, c("OC")/1024, c("MU")/1024, c("GCT"), c("FGC"), c("FGCT"), c("YGC") }' <<< "$(sect GC)")"
    GCPCT=""; [[ -n $UPT && -n $GCT_S ]] && GCPCT=$(awk -v g="$GCT_S" -v u="$UPT" 'BEGIN{ if (u>0) printf "%.1f", 100*g/u }')
    AVGFULL=""; [[ -n $FGC_N ]] && (( FGC_N > 0 )) && AVGFULL=$(awk -v t="$FGCT_S" -v n="$FGC_N" 'BEGIN{printf "%.2f", t/n}')
    NONHEAP=""; [[ -n $MAXHEAP_MI && -n $LMM_MI ]] && NONHEAP=$(( LMM_MI - MAXHEAP_MI ))

    V=$(sect VERSION); [[ -n $V ]] && kv "java" "$V"
    kv "pid / threads" "$JPID / ${THREADS:--}"
    TOOLS=$(echo $TOOLS); kv "tools in image" "${TOOLS:-none → only cmdline/env below}"
    kv "GC" "${GCNAME:-?}"
    kv "max heap" "$(fmt "$MAXHEAP_MI" " MiB")${LMM_MI:+ = $(pctf "$MAXHEAP_MI" "$LMM_MI") of mem limit}${RAMPCT:+  (MaxRAMPercentage=$RAMPCT)}"
    [[ -n $NONHEAP ]] && kv "non-heap headroom" "${NONHEAP} MiB  ${D}(limit − max heap: metaspace, threads, code cache, direct buffers)${N}"
    if [[ -n $H_U ]]; then
      kv "heap used" "${H_U} MiB used / ${H_C} MiB committed / $(fmt "$MAXHEAP_MI" " MiB") max → $(pctf "$H_U" "$MAXHEAP_MI") of max"
      kv "old gen" "${O_U} / ${O_C} MiB ($(pctf "$O_U" "$O_C") of committed)"
      kv "metaspace" "${M_U} MiB"
      kv "GC events" "young=${YGC_N}  full=${FGC_N}${AVGFULL:+  (avg full pause ${AVGFULL}s)}"
      [[ -n $GCPCT ]] && kv "GC time" "${GCT_S}s over ${UPT}s uptime = ${GCPCT}%"
    fi
    hasflag ExitOnOutOfMemoryError && EXITOOM=yes || EXITOOM=no
    hasflag HeapDumpOnOutOfMemoryError && HDUMP="yes → $(flagval HeapDumpPath)" || HDUMP=no
    kv "on OOM" "exit=$EXITOOM  heapdump=$HDUMP"
    [[ -n $JENV ]] && while read -r l; do kv "env" "${l:0:110}"; done <<< "$JENV"

    [[ -z $TOOLS ]] && info "no jcmd/jstat in image (JRE-only) → use PromQL JVM metrics or an ephemeral debug container"
    gt "$(pct "$MAXHEAP_MI" "$LMM_MI")" 85 && warn "max heap = $(pctf "$MAXHEAP_MI" "$LMM_MI") of the memory limit → little room for non-heap → OOMKilled risk; MaxRAMPercentage 70-75"
    [[ -n $MAXHEAP_MI && -n $LMM_MI ]] && ! gt "$(pct "$MAXHEAP_MI" "$LMM_MI")" 50 && info "max heap only $(pctf "$MAXHEAP_MI" "$LMM_MI") of the memory limit → memory paid for but unusable by the heap"
    [[ -n $NONHEAP ]] && (( NONHEAP < 256 )) && warn "non-heap headroom ${NONHEAP} MiB < 256 MiB (metaspace alone is ${M_U:-?} MiB)"
    gt "$(pct "$H_U" "$MAXHEAP_MI")" 85 && warn "heap at $(pctf "$H_U" "$MAXHEAP_MI") of max (point-in-time: confirm with GC time and old gen after a full GC)"
    if gt "$GCPCT" 10; then crit "GC time ${GCPCT}% of uptime → GC thrashing (heap too small or leak; CPU throttling makes it worse)"
    elif gt "$GCPCT" 5; then warn "GC time ${GCPCT}% of uptime"; fi
    gt "$AVGFULL" "$((LTO - 1))" && warn "average full GC pause ${AVGFULL}s vs liveness timeout ${LTO}s → probes fail during full GCs"
    [[ $EXITOOM == no ]] && info "no -XX:+ExitOnOutOfMemoryError → after a heap OOM the JVM may stay up but broken"
    [[ $HDUMP == no ]] && info "no -XX:+HeapDumpOnOutOfMemoryError → next OOM leaves no evidence; add it with HeapDumpPath on a volume"
    [[ $GCNAME == Serial ]] && info "SerialGC (JVM sees 1 CPU or < 1792 MiB): single-threaded stop-the-world pauses"
    gt "${THREADS:-}" 500 && warn "${THREADS} threads → check for an unbounded executor (thread dump below)"
  fi
fi

# ---------------------------------------------------------------- 6. actuator
hdr "6. Actuator (from inside the pod, port $PORT)"
AC=$(kx "$PORT" "$LPATH" "$RPATH" <<'EOF'
command -v curl >/dev/null 2>&1 || { echo "@@NOCURL"; exit 0; }
seen=""
for p in "$2" "$3" /actuator/health /actuator/prometheus; do
  [ -z "$p" ] && continue
  case " $seen " in *" $p "*) continue ;; esac
  seen="$seen $p"
  echo "$p $(curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}' "http://localhost:$1$p")"
done
EOF
)
PROM=0
if [[ -z $AC ]]; then
  kv "actuator" "exec failed"
elif [[ $AC == @@NOCURL ]]; then
  kv "actuator" "curl not in image → test from another pod: curl http://<podIP>:$PORT${LPATH:-/actuator/health}"
else
  HALF=$(awk -v x="$LTO" 'BEGIN{print x/2}')
  while read -r p code t; do
    kv "$p" "HTTP $code  ${t}s"
    if [[ $p == /actuator/prometheus ]]; then
      [[ $code == 200 ]] && PROM=1
    elif [[ $code != 200 ]]; then
      if [[ $p == "$LPATH" ]]; then crit "liveness $p → HTTP $code (000 = timeout/refused)"; else warn "$p → HTTP $code"; fi
    elif gt "$t" "$HALF"; then
      warn "$p answered in ${t}s (≥ 50% of the ${LTO}s liveness timeout)"
    fi
  done <<< "$AC"
  if (( PROM )); then
    SM=$(k get servicemonitor,podmonitor --no-headers 2>/dev/null | wc -l)
    if (( SM == 0 )); then info "/actuator/prometheus exposed but no ServiceMonitor/PodMonitor in $NS → JVM metrics not scraped"
    else info "/actuator/prometheus exposed, $SM ServiceMonitor/PodMonitor in $NS → JVM PromQL queries usable"; fi
  else
    info "no /actuator/prometheus → JVM PromQL queries unavailable (needs micrometer-registry-prometheus)"
  fi
fi

# ---------------------------------------------------------------- 7. events
hdr "7. Warning events"
EV=$(k get events --field-selector "involvedObject.name=$POD,type=Warning" --sort-by=.lastTimestamp --no-headers 2>/dev/null | tail -n 8)
if [[ -z $EV ]]; then kv "events" "none stored"; else sed 's/^/  /' <<< "$EV" | cut -c1-200; fi
UNH=$(k get events --field-selector "involvedObject.name=$POD,reason=Unhealthy" -o jsonpath='{range .items[*]}{.count}{"\n"}{end}' 2>/dev/null | awk 'NF{s+=$1} END{print s+0}')
gt "$UNH" 0 && warn "probe failures recorded: $UNH (Unhealthy events) → correlate with throttling / GC above"

# ---------------------------------------------------------------- 8. node
if [[ -n $NODE ]]; then
  hdr "8. Node $NODE"
  NCPU='' NCPUP='' NMEM='' NMEMP=''
  read -r _ NCPU NCPUP NMEM NMEMP < <("${TOP[@]}" node "$NODE" --no-headers 2>/dev/null)
  kv "usage" "cpu ${NCPU:--} (${NCPUP:--})   memory ${NMEM:--} (${NMEMP:--})"
  COND=$("$CLI" get node "$NODE" -o jsonpath='{range .status.conditions[?(@.status=="True")]}{.type}{" "}{end}' 2>/dev/null)
  kv "conditions=True" "${COND:--}"
  gt "${NCPUP%\%}" 85 && warn "node CPU at $NCPUP → contention on top of the CFS quota"
  gt "${NMEMP%\%}" 90 && warn "node memory at $NMEMP"
  for c in $COND; do [[ $c != Ready ]] && crit "node condition $c=True"; done
fi

# ---------------------------------------------------------------- findings
hdr "Findings"
if (( ${#FIND[@]} == 0 )); then
  printf '  %sno anomalies detected%s\n' "$G" "$N"
else
  for lvl in CRIT WARN INFO; do
    case $lvl in CRIT) col=$R ;; WARN) col=$Y ;; *) col=$G ;; esac
    for f in "${FIND[@]}"; do
      [[ ${f%%|*} == "$lvl" ]] && printf '  %s%-4s%s  %s\n' "$col" "$lvl" "$N" "${f#*|}"
    done
  done
fi

hdr "Next commands"
cat <<EOF
  $CLI -n $NS logs $POD -c $CTR --previous | grep -E 'OutOfMemory|Terminating|Timeout|Exception' | tail -20
  $CLI -n $NS exec $POD -c $CTR -- jstat -gcutil $JPID 5000 12                    # 1 min of GC, 5s step
  $CLI -n $NS exec $POD -c $CTR -- jcmd $JPID Thread.print | grep -oE 'State: [A-Z_]+' | sort | uniq -c
  $CLI -n $NS exec $POD -c $CTR -- jcmd $JPID GC.class_histogram | head -25       # triggers a full GC
EOF
exit 0
```

</details>

Example findings from a real case: Spring Batch job, CPU limit 200m, ParallelGC, heap at 80% of a 1260Mi limit.

```text
▌ Findings
  CRIT  exit 3: JVM -XX:+ExitOnOutOfMemoryError → Java HEAP exhausted (not the container limit) → heap dump / heap sizing
  WARN  CPU limit 200m is low for Spring Boot (startup, JIT and GC need bursts) → expect throttling; ≥ 1 core limit is a sane baseline
  WARN  CPU throttled in 23% of periods since start → CPU limit too tight
  WARN  non-heap headroom 252 MiB < 256 MiB (metaspace alone is 79 MiB)
  WARN  GC time 8.3% of uptime
  WARN  probe failures recorded: 978 (Unhealthy events) → correlate with throttling / GC above
  INFO  no -XX:+HeapDumpOnOutOfMemoryError → next OOM leaves no evidence; add it with HeapDumpPath on a volume
```
