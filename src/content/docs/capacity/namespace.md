---
title: Consumi risorse per namespace
description: Query PromQL per CPU e memoria a livello namespace, istantanee e picchi.
---

Esempio con namespace monitorati: `istio-system`, `openshift-logging`, `registry`. Finestra picco: `7d`, step subquery: `5m`.

## CPU

### Consumo attuale per namespace (core)

```promql
sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{
  cluster="", namespace=~"istio-system|openshift-logging|registry"
}) by (namespace)
```

### Picco per namespace (core, 7d)

```promql
max_over_time(
  sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{
    cluster="", namespace=~"istio-system|openshift-logging|registry"
  }) by (namespace)
[7d:5m])
```

## Memoria

### Consumo attuale per namespace (GiB)

```promql
sum(container_memory_rss{
  job="kubelet", metrics_path="/metrics/cadvisor", cluster="",
  container!="", namespace=~"istio-system|openshift-logging|registry"
}) by (namespace) / 1024^3
```

### Picco per namespace (GiB, 7d)

```promql
max_over_time(
  sum(container_memory_rss{
    job="kubelet", metrics_path="/metrics/cadvisor", cluster="",
    container!="", namespace=~"istio-system|openshift-logging|registry"
  }) by (namespace)
[7d:5m]) / 1024^3
```

## Note

- **CPU**: già in core → `×1000` per millicore.
- **Memoria**: `/ 1024^3` → GiB (base 2, combacia con i `Gi` di K8s); `/ 1e9` → GB decimali.
- La divisione va **fuori** dal `max_over_time`, così l'aggregazione lavora sui byte grezzi.
- Le subquery sono costose: su finestre lunghe allarga lo step, es. `[30d:1h]`.
- `=~` usa regex: attenzione ai pattern tipo `openshift-.*` che catturano più namespace del previsto.
