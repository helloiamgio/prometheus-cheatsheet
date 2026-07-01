---
title: Node NotReady — Runbook
description: Procedura completa per identificare root cause di un nodo NotReady.
---

**Audience:** Operations / SRE / Platform Team

Copre: condizioni nodo, salute kubelet, resource pressure (CPU/Mem/Disk), storage/IO, runtime CRI-O, MachineConfigPool, query Prometheus forensiche.

## 1. Setup

```bash
NODE=<node-name>
# es: NODE=ocp4-worker-0
```

## 2. Node status & conditions

```bash
oc get node $NODE -o wide
oc describe node $NODE | sed -n '/Conditions:/,/Addresses:/p'
oc describe node $NODE | sed -n '/Events:/,$p'
```

Cosa cercare: `Ready=False`, `KubeletNotReady`, `MemoryPressure=True`, `DiskPressure=True`, `PIDPressure=True`, `NetworkUnavailable=True`.

## 3. Kubelet health (API proxy check)

```bash
oc get --raw /api/v1/nodes/$NODE/proxy/healthz ; echo
oc get --raw /api/v1/nodes/$NODE/proxy/stats/summary | head
```

| Risultato | Interpretazione |
|---|---|
| Timeout | kubelet down / nodo frozen |
| 200 OK | kubelet running |
| Stats error | problema runtime/storage |

## 4. Debug shell sul nodo

```bash
oc debug node/$NODE -- chroot /host bash
```

### 4.1 Reboot check

```bash
uptime
who -b
journalctl -b -1 -n 200 --no-pager
```

### 4.2 Memory check

```bash
free -m
vmstat 1 5
journalctl -k | egrep -i "oom|out of memory"
```

### 4.3 Disk & inode check

```bash
df -hT
df -hi
```

Path critici: `/`, `/var/lib/containers`, `/var/lib/kubelet`. Se >85% → investigare subito.

### 4.4 Storage / IO errors

```bash
journalctl -k | egrep -i "I/O error|blocked for more than|hung|reset|xfs|ext4"
```

### 4.5 Kubelet logs

```bash
journalctl -u kubelet -n 200 --no-pager
```

Cercare: `PLEG is not healthy`, `Container runtime is down`, `DeadlineExceeded`, errori dell'eviction manager.

### 4.6 CRI-O logs

```bash
journalctl -u crio -n 200 --no-pager
```

Cercare: storage timeouts, overlay errors, rpc timeout.

### 4.7 Runtime check

```bash
crictl ps -a
```

## 5. Cluster resource pressure

```bash
oc adm top nodes
oc adm top pods -A --sort-by=memory | head -20
oc adm top pods -A --sort-by=cpu | head -20
```

## 6. MachineConfigPool

```bash
oc get mcp
oc describe mcp worker
```

Se `Updating=True` o `Degraded=True` → il nodo potrebbe rebootare per un update MCO.

## 7. Query Prometheus (forensics)

```promql
# Node Ready state
kube_node_status_condition{condition="Ready"}

# Nodes NotReady
kube_node_status_condition{condition="Ready", status="false"}

# Memory usage %
100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))

# OOM events
increase(node_vmstat_oom_kill[1h])

# Root filesystem usage %
100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100

# Container runtime disk usage %
100 - (node_filesystem_avail_bytes{mountpoint="/var/lib/containers"} / node_filesystem_size_bytes{mountpoint="/var/lib/containers"}) * 100

# Disk IO saturation
rate(node_disk_io_time_seconds_total[5m])

# Kubelet restart detection
changes(process_start_time_seconds{job="kubelet"}[1h])
```

## 8. Root cause comuni

| Sintomo | Root cause |
|---|---|
| healthz timeout | kubelet crash / nodo frozen |
| OOM events | esaurimento memoria |
| DiskPressure | disco pieno |
| IO wait alto | latenza storage backend |
| kubelet restarts | crash del runtime |
| MCP Updating | reboot triggerato da MCO |

## 9. Escalation

- **Infrastructure team** → IO errors, storage latency, reboot VM
- **Application team** → memory leak, CPU alta
- **Platform team** → MCO degraded, kubelet crash loop

## 10. Azioni immediate (se workload impattato)

```bash
oc adm cordon $NODE
oc adm drain $NODE --ignore-daemonsets --delete-emptydir-data --force --grace-period=60 --timeout=10m
```

Poi investigare offline.

## 11. Chiusura incidente

- catturare i grafici Prometheus
- allegare i log kubelet
- allegare output `df`
- documentare la timeline (prima occorrenza NotReady)
