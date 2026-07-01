---
title: Capacity cluster / nodi worker
description: Query aggregate di capacity a livello cluster.
---

Vedi anche [Node → CPU/RAM/Capacity](/node/) per le query per singolo nodo worker.

### % CPU richieste dai pod rispetto alle CPU allocabili del cluster

```promql
sum(namespace_cpu:kube_pod_container_resource_requests:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="cpu", cluster=""})
```

### % CPU limits impostati rispetto alle CPU allocabili del cluster

```promql
sum(namespace_cpu:kube_pod_container_resource_limits:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="cpu", cluster=""})
```

### % RAM disponibile sul cluster

```promql
sum(:node_memory_MemAvailable_bytes:sum{cluster=""}) / sum(node_memory_MemTotal_bytes{job="node-exporter", cluster=""})
```

### % RAM richieste / limits rispetto all'allocabile del cluster

```promql
sum(namespace_memory:kube_pod_container_resource_requests:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="memory", cluster=""})

sum(namespace_memory:kube_pod_container_resource_limits:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="memory", cluster=""})
```

## Nota operativa WR

> In caso di incidente, partire sempre da:
> **CPU → Memoria → Restart → Rete → Storage → Job**
> e correlare **spike + eventi** per identificare la root cause.
