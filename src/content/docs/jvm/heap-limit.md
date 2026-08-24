---
title: Heap e limit
description: Saturazione memoria, CPU throttling e distinzione fra memory leak e undersizing da metriche cAdvisor.
sidebar:
  order: 1
---

Query che non richiedono exporter JVM: funzionano su qualsiasi workload Java del cluster. Unica variabile: `$NS`. Vedi [come si usano](/jvm/#come-si-usano-queste-query).

## 1. Saturazione memoria vs limit

Prima query da lanciare. Sopra l'85% stabile il GC gira in continuo.

### Tutti i container del namespace

```promql
100 * container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}
  / on(namespace,pod,container) group_left
kube_pod_container_resource_limits{resource="memory",namespace="$NS"}
```

### Solo i più saturi, ordinati

```promql
topk(10,
  100 * container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}
    / on(namespace,pod,container) group_left
  kube_pod_container_resource_limits{resource="memory",namespace="$NS"}
)
```

### Filtro sui pod

```promql
100 * container_memory_working_set_bytes{namespace="$NS",pod=~"nome-app-.*",container!="",container!="POD"}
  / on(namespace,pod,container) group_left
kube_pod_container_resource_limits{resource="memory",namespace="$NS"}
```

### Totale del namespace

```promql
100 * sum(container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"})
    / sum(kube_pod_container_resource_limits{resource="memory",namespace="$NS"})
```

### Top namespace del cluster

Per capire se il problema è isolato o diffuso.

```promql
topk(15,
  100 * sum by (namespace) (container_memory_working_set_bytes{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"})
    / sum by (namespace) (kube_pod_container_resource_limits{resource="memory",namespace!~"kube-.*|openshift-.*"})
)
```

### Working set in GiB

```promql
sum by (pod, container) (container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}) / 1024^3
```

### RSS vs working set

Delta ampio significa molta page cache contabilizzata nel limit: il margine reale è più stretto di quanto sembri.

```promql
sum by (pod, container) (container_memory_rss{namespace="$NS",container!="",container!="POD"})
  / sum by (pod, container) (container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"})
```

## 2. CPU throttling

Causa sottovalutata di pause GC lunghe: i thread del collector non ottengono quota CFS. Sopra il 25% è patologico per un workload Java.

### Tutti i container del namespace

```promql
100 * sum by (pod, container) (rate(container_cpu_cfs_throttled_periods_total{namespace="$NS",container!="",container!="POD"}[5m]))
    / sum by (pod, container) (rate(container_cpu_cfs_periods_total{namespace="$NS",container!="",container!="POD"}[5m]))
```

### Ordinati per gravità

```promql
topk(10,
  100 * sum by (pod, container) (rate(container_cpu_cfs_throttled_periods_total{namespace="$NS",container!="",container!="POD"}[5m]))
      / sum by (pod, container) (rate(container_cpu_cfs_periods_total{namespace="$NS",container!="",container!="POD"}[5m]))
)
```

### Filtro sui pod

```promql
100 * sum by (pod, container) (rate(container_cpu_cfs_throttled_periods_total{namespace="$NS",pod=~"nome-app-.*",container!=""}[5m]))
    / sum by (pod, container) (rate(container_cpu_cfs_periods_total{namespace="$NS",pod=~"nome-app-.*",container!=""}[5m]))
```

### Top container throttled del cluster

```promql
topk(10,
  100 * sum by (namespace,pod,container) (rate(container_cpu_cfs_throttled_periods_total{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"}[5m]))
      / sum by (namespace,pod,container) (rate(container_cpu_cfs_periods_total{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"}[5m]))
)
```

### CPU usata vs limit — 1 significa saturo

```promql
sum by (pod, container) (rate(container_cpu_usage_seconds_total{namespace="$NS",container!="",container!="POD"}[5m]))
  / on(namespace,pod,container) group_left
kube_pod_container_resource_limits{resource="cpu",namespace="$NS"}
```

### Core effettivi assegnati dal CFS

Sotto 2 core il collector parallelo degrada sensibilmente.

```promql
sum by (pod, container) (container_spec_cpu_quota{namespace="$NS",container!="",container!="POD"})
  / sum by (pod, container) (container_spec_cpu_period{namespace="$NS",container!="",container!="POD"})
```

## 3. Leak o undersizing

Distinguere i due casi cambia il rimedio: alzare il limit su un leak sposta il problema di qualche ora.

### Derivata su 6h

Se resta stabilmente > 0 è un leak.

```promql
deriv(container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}[6h])
```

### Crescita in MiB/ora, ordinata

```promql
topk(10,
  deriv(container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}[6h]) * 3600 / 1024^2
)
```

### Filtro sui pod

```promql
deriv(container_memory_working_set_bytes{namespace="$NS",pod=~"nome-app-.*",container!=""}[6h]) * 3600 / 1024^2
```

### Picco settimanale

Base per il rightsizing, da confrontare col limit attuale. Vedi anche [Capacity per namespace](/capacity/namespace/).

```promql
max_over_time(container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}[7d:5m]) / 1024^3
```

### Pattern a dente di sega

Se il minimo settimanale cresce insieme al massimo la old gen non viene liberata: leak confermato.

```promql
min_over_time(container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}[7d:5m]) / 1024^3
```

### Ore stimate prima di toccare il limit

Risultato negativo o assente = nessuna crescita, quindi undersizing e non leak.

```promql
(
  kube_pod_container_resource_limits{resource="memory",namespace="$NS"}
  - on(namespace,pod,container)
  container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}
)
/ on(namespace,pod,container)
deriv(container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}[6h])
/ 3600
```

### Proiezione a 4 ore

```promql
predict_linear(container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}[6h], 4*3600) / 1024^3
```

## 4. Limit e configurazione

### Limit memoria configurati, in GiB

Da confrontare con `-Xmx`: il rapporto non dovrebbe superare 0.75.

```promql
kube_pod_container_resource_limits{namespace="$NS",resource="memory"} / 1024^3
```

### Container senza limit di memoria

Senza limit la JVM vede tutta la RAM host e dimensiona l'heap di conseguenza: candidati a far esplodere il nodo.

```promql
count by (namespace,pod,container) (container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"})
unless on(namespace,pod,container)
kube_pod_container_resource_limits{resource="memory"}
```

### Nel cluster intero

```promql
count by (namespace,pod,container) (container_memory_working_set_bytes{container!="",container!="POD",namespace!~"kube-.*|openshift-.*"})
unless on(namespace,pod,container)
kube_pod_container_resource_limits{resource="memory"}
```

Per OOMKill, restart e correlazione con `terminated reason` vedi [Restart / CrashLoop / OOM](/pod/restart-oom/).

## 5. Isolare applicativo e sidecar

In un pod con sidecar Istio il raggruppamento `by (pod, container)` li separa già. Per le metriche di mesh vedi [Multi-container](/pod/multicontainer/).

### Solo i container applicativi

```promql
sum by (pod, container) (container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD",container!="istio-proxy"}) / 1024^3
```

### Solo i sidecar

```promql
sum by (pod) (container_memory_working_set_bytes{namespace="$NS",container="istio-proxy"}) / 1024^3
```

### Rapporto sidecar / applicativo

```promql
sum by (pod) (container_memory_working_set_bytes{namespace="$NS",container="istio-proxy"})
  / sum by (pod) (container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD",container!="istio-proxy"})
```
