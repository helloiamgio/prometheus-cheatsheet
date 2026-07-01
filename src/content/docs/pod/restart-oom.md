---
title: Restart / CrashLoop / OOM
description: Query per restart, crash loop e OOMKilled a livello pod/container.
---

## Restart

### Restart per pod (15m)

```promql
increase(
  kube_pod_container_status_restarts_total{namespace!~"kube-.*|openshift-.*"}[15m]
)
```

### Crash looping (>3 restart in 1m)

```promql
increase(kube_pod_container_status_restarts_total[1m]) > 3
```

## OOMKilled

### Stato attuale

```promql
kube_pod_container_status_last_terminated_reason{
  namespace!~"kube-.*|openshift-.*",
  reason="OOMKilled"
}
```

### Storico (24h)

```promql
increase(
  kube_pod_container_status_last_terminated_reason{
    namespace!~"kube-.*|openshift-.*",
    reason="OOMKilled"
  }[24h]
)
```

### OOM killer con correlazione al container specifico (alert-ready)

```promql
(kube_pod_container_status_restarts_total - kube_pod_container_status_restarts_total offset 10m >= 1)
and ignoring (reason)
min_over_time(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}[10m]) == 1
```

### OOM a livello nodo (kernel)

```promql
increase(node_vmstat_oom_kill[1h])
```

## Stato generale pod

### Pod non Ready

```promql
kube_pod_status_ready{
  namespace!~"kube-.*|openshift-.*",
  condition="false"
}
```

### Pod non sani (Pending/Unknown/Failed)

```promql
sum by (namespace, pod) (
  kube_pod_status_phase{phase=~"Pending|Unknown|Failed"}
) > 0
```

### Numero pod per namespace

```promql
count by (namespace) (
  kube_pod_info{namespace!~"kube-.*|openshift-.*"}
)
```

### Pod out of capacity sul nodo (>90% pod allocabili)

```promql
sum by (node) (
  (kube_pod_status_phase{phase="Running"} == 1)
  + on(uid) group_left(node) (0 * kube_pod_info{pod_template_hash=""})
)
/
sum by (node) (kube_node_status_allocatable{resource="pods"}) * 100 > 90
```
