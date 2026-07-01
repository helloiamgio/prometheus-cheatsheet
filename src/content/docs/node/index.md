---
title: CPU / RAM / Capacity per nodo
description: Query di capacity e utilizzo a livello nodo worker.
---

## CPU

### Utilizzo reale CPU sui nodi (media mobile 5m, escluso idle)

```promql
cluster:node_cpu:ratio_rate5m{cluster=""}
```

### CPU Usage per nodo worker (%)

```promql
100 *
max by (nodename) (
  (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))
  * on(instance) group_left(nodename) node_uname_info
  * on(nodename) group_left()
    label_replace(kube_node_role{role="worker"}, "nodename", "$1", "node", "(.*)")
)
```

### CPU Usage per nodo worker (core)

```promql
max by (nodename) (
  sum by (instance) (rate(node_cpu_seconds_total{mode!~"idle|iowait|steal"}[5m]))
  * on(instance) group_left(nodename) node_uname_info
  * on(nodename) group_left()
    label_replace(kube_node_role{role="worker"}, "nodename", "$1", "node", "(.*)")
)
```

### CPU disponibile per scheduling (allocatable - requests)

```promql
sum(kube_node_status_allocatable{resource="cpu", unit="core", node=~".*worker.*"}) by (node)
-
sum(kube_pod_container_resource_requests{resource="cpu", unit="core", node=~".*worker.*"}) by (node)
```

### % CPU disponibile (istantaneo, idle reale)

```promql
100 * (
  sum by (instance) (rate(node_cpu_seconds_total{mode="idle", instance=~".*worker.*"}[5m]))
  /
  sum by (instance) (rate(node_cpu_seconds_total{instance=~".*worker.*"}[5m]))
)
```

## Memoria

### RAM usata per nodo worker (%)

```promql
100 *
max by (nodename) (
  instance:node_memory_utilisation:ratio
  * on(instance) group_left(nodename) node_uname_info
  * on(nodename) group_left()
    label_replace(kube_node_role{role="worker"}, "nodename", "$1", "node", "(.*)")
)
```

### RAM usata per nodo worker (GiB)

```promql
max by (nodename) (
  (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)
  * on(instance) group_left(nodename) node_uname_info
  * on(nodename) group_left()
    label_replace(kube_node_role{role="worker"}, "nodename", "$1", "node", "(.*)")
) / 1024 / 1024 / 1024
```

### RAM disponibile per scheduling (allocatable - requests, GiB)

```promql
(
  sum(kube_node_status_allocatable{resource="memory", unit="byte", node=~".*worker.*"}) by (node)
  -
  sum(kube_pod_container_resource_requests{resource="memory", unit="byte", node=~".*worker.*"}) by (node)
) / 1024 / 1024 / 1024
```

### % RAM disponibile

```promql
(node_memory_MemAvailable_bytes{instance=~".*worker.*"} / node_memory_MemTotal_bytes{instance=~".*worker.*"}) * 100
```

## Requests / Limits per nodo (overcommit)

```promql
# CPU Requests %
100 * sum(kube_pod_container_resource_requests{resource="cpu", unit="core"}) by (node)
  / sum(kube_node_status_allocatable{resource="cpu", unit="core"}) by (node)

# CPU Limits %
100 * sum(kube_pod_container_resource_limits{resource="cpu", unit="core"}) by (node)
  / sum(kube_node_status_allocatable{resource="cpu", unit="core"}) by (node)

# RAM Requests %
100 * sum(kube_pod_container_resource_requests{resource="memory", unit="byte"}) by (node)
  / sum(kube_node_status_allocatable{resource="memory", unit="byte"}) by (node)
  and on(node) kube_node_status_allocatable{node=~".*worker.*"}

# RAM Limits %
100 * sum(kube_pod_container_resource_limits{resource="memory", unit="byte"}) by (node)
  / sum(kube_node_status_allocatable{resource="memory", unit="byte"}) by (node)
  and on(node) kube_node_status_allocatable{node=~".*worker.*"}
```

## Storico (30d) min/max/avg

```promql
avg_over_time(instance:node_memory_utilisation:ratio{job="node-exporter"}[30d]) * 100
max_over_time(instance:node_memory_utilisation:ratio{job="node-exporter"}[30d]) * 100

avg_over_time(instance:node_cpu_utilisation:rate1m{job="node-exporter"}[30d]) * 100
max_over_time(instance:node_cpu_utilisation:rate1m{job="node-exporter"}[30d]) * 100
```

## Totali cluster (nodi worker)

```promql
# CPU request totale
sum(
  kube_pod_container_resource_requests{resource="cpu", unit="core"}
  * on(node) group_left(role) kube_node_role{role="worker"}
)

# RAM request totale (GiB)
sum(
  kube_pod_container_resource_requests{resource="memory", unit="byte"}
  * on(node) group_left(role) kube_node_role{role="worker"}
) / 1024^3

# CPU usata totale
sum(
  rate(container_cpu_usage_seconds_total{container!="", container!="POD", pod!=""}[5m])
  * on(namespace, pod) group_left(node) max by(namespace, pod, node) (kube_pod_info)
  * on(node) group_left() max by(node) (kube_node_role{role="worker"})
)

# RAM usata totale (GiB)
sum(
  container_memory_working_set_bytes{container!="", container!="POD", pod!=""}
  * on(namespace, pod) group_left(node) max by(namespace, pod, node) (kube_pod_info)
  * on(node) group_left() max by(node) (kube_node_role{role="worker"})
) / 1024^3
```

## Percentuale CPU/RAM richieste rispetto all'allocabile del cluster

```promql
sum(namespace_cpu:kube_pod_container_resource_requests:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="cpu", cluster=""})

sum(namespace_cpu:kube_pod_container_resource_limits:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="cpu", cluster=""})

sum(namespace_memory:kube_pod_container_resource_requests:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="memory", cluster=""})

sum(namespace_memory:kube_pod_container_resource_limits:sum{cluster=""})
/ sum(kube_node_status_allocatable{job="kube-state-metrics", resource="memory", cluster=""})
```
