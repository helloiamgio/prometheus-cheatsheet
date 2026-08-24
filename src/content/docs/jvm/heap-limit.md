---
title: Heap e limit
description: Saturazione memoria, CPU throttling e distinzione fra memory leak e undersizing da metriche cAdvisor.
sidebar:
  order: 1
---

Query che non richiedono exporter JVM: funzionano su qualsiasi workload Java del cluster. Placeholder `$NS` / `$APP` come da [sezione JVM](/jvm/).

## 1. Saturazione memoria vs limit

Prima query da lanciare. Sopra l'85% stabile il GC gira in continuo.

### Per container

```promql
100 * container_memory_working_set_bytes{namespace="$NS",container="$APP"}
  / on(namespace,pod,container) group_left
kube_pod_container_resource_limits{resource="memory",namespace="$NS",container="$APP"}
```

### Aggregata per namespace

```promql
100 * sum by (namespace) (container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"})
  / sum by (namespace) (kube_pod_container_resource_limits{resource="memory",namespace="$NS"})
```

### Top 10 container più saturi del cluster

```promql
topk(10,
  100 * container_memory_working_set_bytes{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"}
    / on(namespace,pod,container) group_left
  kube_pod_container_resource_limits{resource="memory"}
)
```

### Namespace ordinati per saturazione

```promql
topk(15,
  100 * sum by (namespace) (container_memory_working_set_bytes{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"})
    / sum by (namespace) (kube_pod_container_resource_limits{resource="memory",namespace!~"kube-.*|openshift-.*"})
)
```

### Working set in GiB

```promql
container_memory_working_set_bytes{namespace="$NS",container="$APP"} / 1024^3
```

### RSS vs working set

Delta ampio significa molta page cache contabilizzata nel limit: il margine reale è più stretto di quanto sembri.

```promql
container_memory_rss{namespace="$NS",container="$APP"}
  / container_memory_working_set_bytes{namespace="$NS",container="$APP"}
```

## 2. CPU throttling

Causa sottovalutata di pause GC lunghe: i thread del collector non ottengono quota CFS. Sopra il 25% è patologico per un workload Java.

### Percentuale di periodi throttled

```promql
100 * rate(container_cpu_cfs_throttled_periods_total{namespace="$NS",container="$APP"}[5m])
    / rate(container_cpu_cfs_periods_total{namespace="$NS",container="$APP"}[5m])
```

### Top 10 container throttled del cluster

```promql
topk(10,
  100 * sum by (namespace,pod,container) (rate(container_cpu_cfs_throttled_periods_total{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"}[5m]))
      / sum by (namespace,pod,container) (rate(container_cpu_cfs_periods_total{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"}[5m]))
)
```

### Aggregato per namespace

```promql
100 * sum by (namespace) (rate(container_cpu_cfs_throttled_periods_total{namespace=~"$NS",container!=""}[5m]))
    / sum by (namespace) (rate(container_cpu_cfs_periods_total{namespace=~"$NS",container!=""}[5m]))
```

### CPU usata vs limit — 1 significa saturo

```promql
rate(container_cpu_usage_seconds_total{namespace="$NS",container="$APP"}[5m])
  / on(namespace,pod,container) group_left
kube_pod_container_resource_limits{resource="cpu",namespace="$NS",container="$APP"}
```

### Core effettivi assegnati dal CFS

Sotto 2 core il collector parallelo degrada sensibilmente.

```promql
container_spec_cpu_quota{namespace="$NS",container="$APP"}
  / container_spec_cpu_period{namespace="$NS",container="$APP"}
```

## 3. Leak o undersizing

Distinguere i due casi cambia il rimedio: alzare il limit su un leak sposta il problema di qualche ora.

### Derivata su 6h

Se resta stabilmente > 0 è un leak.

```promql
deriv(container_memory_working_set_bytes{namespace="$NS",container="$APP"}[6h])
```

### Crescita in MiB/ora

```promql
deriv(container_memory_working_set_bytes{namespace="$NS",container="$APP"}[6h]) * 3600 / 1024^2
```

### Picco settimanale

Base per il rightsizing, da confrontare col limit attuale. Vedi anche [Capacity per namespace](/capacity/namespace/).

```promql
max_over_time(container_memory_working_set_bytes{namespace="$NS",container="$APP"}[7d:5m]) / 1024^3
```

### Pattern a dente di sega

Se il minimo settimanale cresce insieme al massimo la old gen non viene liberata: leak confermato.

```promql
min_over_time(container_memory_working_set_bytes{namespace="$NS",container="$APP"}[7d:5m]) / 1024^3
```

### Ore stimate prima di toccare il limit

Risultato negativo o assente = nessuna crescita, quindi undersizing e non leak.

```promql
(
  kube_pod_container_resource_limits{resource="memory",namespace="$NS",container="$APP"}
  - on(namespace,pod,container)
  container_memory_working_set_bytes{namespace="$NS",container="$APP"}
)
/ on(namespace,pod,container)
deriv(container_memory_working_set_bytes{namespace="$NS",container="$APP"}[6h])
/ 3600
```

### Proiezione a 4 ore

```promql
predict_linear(container_memory_working_set_bytes{namespace="$NS",container="$APP"}[6h], 4*3600) / 1024^3
```

## 4. Container senza limit di memoria

Candidati a far esplodere il nodo: senza limit la JVM vede tutta la RAM host e dimensiona l'heap di conseguenza.

```promql
count by (namespace,pod,container) (container_memory_working_set_bytes{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"})
unless on(namespace,pod,container)
kube_pod_container_resource_limits{resource="memory"}
```

Per OOMKill, restart e correlazione con `terminated reason` vedi [Restart e OOM](/pod/restart-oom/).

## 5. Isolare applicativo e sidecar

In un pod con sidecar Istio il filtro `container` separa l'heap dall'overhead Envoy. Per le metriche di mesh vedi [Istio](/istio/).

### Memoria del solo sidecar per namespace

```promql
sum by (namespace) (container_memory_working_set_bytes{namespace=~"$NS",container="istio-proxy"}) / 1024^3
```

### Rapporto sidecar / applicativo

```promql
sum by (pod) (container_memory_working_set_bytes{namespace="$NS",container="istio-proxy"})
  / sum by (pod) (container_memory_working_set_bytes{namespace="$NS",container="$APP"})
```
