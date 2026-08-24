---
title: JVM
description: Diagnosticare pause GC, saturazione heap e OOMKill di workload Java su Kubernetes / OpenShift.
sidebar:
  order: 0
---

## Cosa vede Prometheus e cosa no

cAdvisor/kubelet **non vedono dentro la JVM**. Le metriche `container_*` misurano il cgroup, non l'heap. Le metriche `jvm_*` esistono solo se il pod espone un endpoint Micrometer o `jmx_exporter`.

| Sintomo APM (Dynatrace / AppDynamics) | Proxy da metriche container | Affidabilità |
|---|---|---|
| `Long garbage-collection time` | saturazione memoria vs limit + CPU throttling | indiretta, alta |
| `Suspension %` in salita | `rate(jvm_gc_pause_seconds_sum[5m]) * 100` | diretta, serve exporter |
| `Memory leak detected` | `deriv(container_memory_working_set_bytes[6h])` costante > 0 | indiretta, media |
| `Process crash` | `kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}` | diretta |
| Heap old gen piena | `jvm_memory_used_bytes{id=~".*Old Gen"}` | diretta, serve exporter |

Regola pratica: **senza exporter JVM, saturazione memoria e throttling CPU spiegano la quasi totalità degli allarmi GC**. Se entrambi sono bassi il problema è applicativo — allocation rate, oggetti long-lived — e servono i dati JVM.

## Parametri

Le query di questa sezione usano tre placeholder:

```
$NS    → namespace          es. r4396-riquadro-be
$APP   → nome container     es. rq-vop-gateway
$POD   → regex sui pod      es. rq-vop-gateway-.*
```

Con sidecar Istio il filtro `container` è **obbligatorio**: senza, le metriche sommano applicativo ed Envoy. Verifica il nome esatto del container applicativo:

```promql
kube_pod_container_info{namespace="$NS"}
```

## Runbook

Ordine di indagine a partire da un allarme GC dell'APM.

1. **Saturazione memoria vs limit** → [Heap e limit](/jvm/heap-limit/#1-saturazione-memoria-vs-limit). Sopra 85% stabile la JVM entra in ciclo di GC continuo ben prima dell'OOMKill: vai al punto 3.
2. **Throttling CPU** → [Heap e limit](/jvm/heap-limit/#2-cpu-throttling). Sopra 25% i thread del collector non ottengono quota CFS e le pause si allungano anche con heap abbondante. Alza il limit CPU prima di toccare la memoria. Molto spesso l'indagine finisce qui.
3. **Leak o undersizing** → [Heap e limit](/jvm/heap-limit/#3-leak-o-undersizing). Derivata a 6h positiva e costante più minimo settimanale crescente = leak, serve heap dump. Curva piatta ad alto livello = undersizing, basta il rightsizing.
4. **OOMKill e restart** → [Restart e OOM](/pod/restart-oom/). Se il container viene ucciso verifica il rapporto `-Xmx` / limit.
5. **Sidecar mesh** → [Istio control plane](/istio/control-plane/). Envoy concorre al totale del pod ma non all'heap.
6. **Metriche JVM** → [Metriche JVM](/jvm/metriche/). Se i primi cinque punti sono puliti il problema è dentro l'applicazione.

## Dimensionamento heap

`-Xmx` non dovrebbe superare il **70-75% del limit memoria** del container: il resto serve a metaspace, code cache, thread stack, direct buffer e allocazioni native. Con `-XX:MaxRAMPercentage` il calcolo è automatico ma il default della JVM (25%) è quasi sempre troppo conservativo e spreca metà del limit.

```promql
kube_pod_container_resource_limits{namespace="$NS",container="$APP"} / 1024^3
```

```bash
oc -n $NS set env deploy/$APP --list | grep -Ei 'JAVA_OPTS|JAVA_TOOL_OPTIONS|XMX|XMS|MaxRAM'
```
