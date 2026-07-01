---
title: CPU & Memoria per Pod/Container
description: Query base di consumo risorse a livello pod e container.
---

Filtro standard namespace applicativi da applicare ovunque:

```promql
namespace!~"kube-.*|openshift-.*"
```

## CPU

### CPU usage per pod (somma di tutti i container)

```promql
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{
    namespace!~"kube-.*|openshift-.*",
    container!="", container!="POD"
  }[5m])
)
```

### CPU usage per pod, breakdown per container

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{
    namespace!~"kube-.*|openshift-.*",
    container!="", container!="POD"
  }[5m])
)
```

### CPU usage vs limit (rischio throttling)

```promql
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
/
sum by (namespace, pod) (
  container_spec_cpu_quota{namespace!~"kube-.*|openshift-.*"}
  / container_spec_cpu_period{namespace!~"kube-.*|openshift-.*"}
)
```

### CPU throttling (evento certo, non stimato)

```promql
rate(container_cpu_cfs_throttled_seconds_total{
  namespace!~"kube-.*|openshift-.*"
}[5m])
```

### % periodi throttled sul totale periodi CFS

```promql
sum by (namespace, pod, container) (
  increase(container_cpu_cfs_throttled_periods_total{container!=""}[5m])
)
/
sum by (namespace, pod, container) (
  increase(container_cpu_cfs_periods_total{container!=""}[5m])
)
```

## Memoria

### Memory usage per pod (working set, somma container)

```promql
sum by (namespace, pod) (
  container_memory_working_set_bytes{
    namespace!~"kube-.*|openshift-.*",
    container!="", container!="POD"
  }
)
```

### Memory usage per container

```promql
container_memory_working_set_bytes{
  namespace!~"kube-.*|openshift-.*",
  container!="", container!="POD"
}
```

### Memory RSS (uso reale del processo, non cache)

```promql
container_memory_rss{
  namespace!~"kube-.*|openshift-.*",
  container!="", container!="POD"
}
```

### Memory usage vs limit (rischio OOM)

```promql
container_memory_working_set_bytes{namespace!~"kube-.*|openshift-.*"}
/
container_spec_memory_limit_bytes{namespace!~"kube-.*|openshift-.*"}
```

### Memory limit non impostato (limit=0, rischio noisy neighbour)

```promql
container_spec_memory_limit_bytes{
  namespace!~"kube-.*|openshift-.*", container!=""
} == 0
```

## Confronto requests/limits vs consumo reale

```promql
# CPU: uso reale / requests dichiarate
sum by (namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{container!="", container!="POD"}[5m])
)
/ on(namespace, pod, container) group_left
sum by (namespace, pod, container) (
  kube_pod_container_resource_requests{resource="cpu"}
)

# Memoria: uso reale / requests dichiarate
sum by (namespace, pod, container) (
  container_memory_working_set_bytes{container!="", container!="POD"}
)
/ on(namespace, pod, container) group_left
sum by (namespace, pod, container) (
  kube_pod_container_resource_requests{resource="memory"}
)
```

Utile per capire pod **oversized** (requests molto più alte del consumo reale → spreco quota nodo) o **sottodimensionati** (rischio throttling/OOM).
