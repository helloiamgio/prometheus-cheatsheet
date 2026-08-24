---
title: Metriche JVM
description: Query su metriche esposte da Micrometer o jmx_exporter — suspension, old gen, allocation rate — e alert pronti.
sidebar:
  order: 2
---

Disponibili solo se il pod espone `/actuator/prometheus` (Micrometer) o un `jmx_exporter`, con user-workload monitoring attivo e un `ServiceMonitor` o `PodMonitor` sul namespace.

## Verificare che esistano

Console → barra di ricerca metriche, cerca `jvm_`. Oppure:

```promql
count by (__name__) ({__name__=~"jvm_.*",namespace="$NS"})
```

Se il monitoring utente non è abilitato la console restituisce **vuoto senza errore**, facile da scambiare per "nessun problema".

```bash
oc -n openshift-user-workload-monitoring get pods
```

```bash
oc -n $NS get servicemonitor,podmonitor
```

Abilitazione, se manca:

```bash
oc -n openshift-monitoring edit configmap cluster-monitoring-config
```

```yaml
data:
  config.yaml: |
    enableUserWorkload: true
```

## Equivalenza dei nomi metrica

I due exporter usano naming diversi. Verifica quale hai prima di copiare le query.

| Concetto | Micrometer (Spring Boot) | jmx_exporter |
|---|---|---|
| Heap usato | `jvm_memory_used_bytes{area="heap"}` | `jvm_memory_bytes_used{area="heap"}` |
| Heap max | `jvm_memory_max_bytes{area="heap"}` | `jvm_memory_bytes_max{area="heap"}` |
| Pool specifico | `jvm_memory_used_bytes{id="G1 Old Gen"}` | `jvm_memory_pool_bytes_used{pool="G1 Old Gen"}` |
| Tempo GC | `jvm_gc_pause_seconds_sum` | `jvm_gc_collection_seconds_sum` |
| Numero GC | `jvm_gc_pause_seconds_count` | `jvm_gc_collection_seconds_count` |
| Thread vivi | `jvm_threads_live_threads` | `jvm_threads_current` |
| Classi caricate | `jvm_classes_loaded_classes` | `jvm_classes_loaded` |

Le query sotto usano il naming Micrometer.

## Suspension %

Equivalente diretto del grafico "Suspension" degli APM. Sopra 5% l'applicazione perde throughput in modo percepibile, sopra 20% è degrado grave.

```promql
100 * sum by (pod) (rate(jvm_gc_pause_seconds_sum{namespace="$NS",pod=~"$POD"}[5m]))
```

### Aggregata per namespace

```promql
100 * sum by (namespace) (rate(jvm_gc_pause_seconds_sum{namespace=~"$NS"}[5m]))
  / count by (namespace) (jvm_gc_pause_seconds_count{namespace=~"$NS"})
```

### Top 10 pod del cluster per tempo in GC

```promql
topk(10, 100 * sum by (namespace,pod) (rate(jvm_gc_pause_seconds_sum{namespace!~"kube-.*|openshift-.*"}[5m])))
```

## Occupazione heap

```promql
100 * sum by (pod) (jvm_memory_used_bytes{namespace="$NS",area="heap"})
    / sum by (pod) (jvm_memory_max_bytes{namespace="$NS",area="heap"})
```

### Old gen — separa leak da undersizing

Se resta sopra il 90% anche dopo i full GC l'heap non si libera.

```promql
100 * jvm_memory_used_bytes{namespace="$NS",area="heap",id=~".*Old Gen"}
    / jvm_memory_max_bytes{namespace="$NS",area="heap",id=~".*Old Gen"}
```

### Non-heap

Metaspace e code cache: crescita costante qui indica classloader leak, tipico dei redeploy a caldo.

```promql
jvm_memory_used_bytes{namespace="$NS",area="nonheap"} / 1024^2
```

## Pause

### Durata media della singola pausa

```promql
rate(jvm_gc_pause_seconds_sum{namespace="$NS"}[5m])
  / rate(jvm_gc_pause_seconds_count{namespace="$NS"}[5m])
```

### p99

```promql
histogram_quantile(0.99,
  sum by (le,pod) (rate(jvm_gc_pause_seconds_bucket{namespace="$NS"}[5m]))
)
```

### Frequenza dei full GC

Su G1 i cicli `Pause Full` sono un fallback: se compaiono con regolarità la configurazione è sbagliata.

```promql
rate(jvm_gc_pause_seconds_count{namespace="$NS",action="end of major GC"}[5m])
```

## Allocation rate

MiB/s promossi in old gen. Valori alti con old gen stabile indicano churn, non leak.

```promql
rate(jvm_gc_memory_promoted_bytes_total{namespace="$NS"}[5m]) / 1024^2
```

```promql
rate(jvm_gc_memory_allocated_bytes_total{namespace="$NS"}[5m]) / 1024^2
```

## Heap vs working set del container

Il delta è memoria non-heap: metaspace, direct buffer, thread stack, JIT. Se cresce mentre l'heap è stabile il leak è nativo e nessun heap dump lo mostrerà.

```promql
(
  container_memory_working_set_bytes{namespace="$NS",container="$APP"}
  - on(namespace,pod) group_left
  sum by (namespace,pod) (jvm_memory_used_bytes{namespace="$NS",area="heap"})
) / 1024^3
```

## Thread

Crescita monotona = thread leak, spesso pool non chiusi. Ogni thread costa ~1 MiB di stack fuori heap.

```promql
jvm_threads_live_threads{namespace="$NS"}
```

```promql
deriv(jvm_threads_live_threads{namespace="$NS"}[6h])
```

## Alert

`PrometheusRule` da applicare sul namespace applicativo con user-workload monitoring attivo. Vedi anche [Alerting operativo](/alerts/).

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: jvm-gc-alerts
  namespace: $NS
spec:
  groups:
  - name: jvm.rules
    rules:
    - alert: ContainerMemoryNearLimit
      expr: |
        100 * container_memory_working_set_bytes{namespace="$NS",container!="",container!="POD"}
          / on(namespace,pod,container) group_left
        kube_pod_container_resource_limits{resource="memory",namespace="$NS"} > 85
      for: 15m
      labels:
        severity: warning
      annotations:
        summary: "{{ $labels.pod }}/{{ $labels.container }} oltre 85% del limit memoria"

    - alert: ContainerCpuThrottling
      expr: |
        100 * rate(container_cpu_cfs_throttled_periods_total{namespace="$NS",container!=""}[5m])
            / rate(container_cpu_cfs_periods_total{namespace="$NS",container!=""}[5m]) > 25
      for: 15m
      labels:
        severity: warning
      annotations:
        summary: "{{ $labels.pod }}/{{ $labels.container }} throttled oltre 25%"

    - alert: JvmHighGcSuspension
      expr: |
        100 * sum by (namespace,pod) (rate(jvm_gc_pause_seconds_sum{namespace="$NS"}[5m])) > 10
      for: 10m
      labels:
        severity: critical
      annotations:
        summary: "{{ $labels.pod }} oltre 10% del tempo in pausa GC"

    - alert: JvmOldGenSaturated
      expr: |
        100 * jvm_memory_used_bytes{namespace="$NS",area="heap",id=~".*Old Gen"}
            / jvm_memory_max_bytes{namespace="$NS",area="heap",id=~".*Old Gen"} > 90
      for: 20m
      labels:
        severity: critical
      annotations:
        summary: "{{ $labels.pod }} old gen oltre 90% — sospetto leak"
```

```bash
oc apply -f jvm-gc-alerts.yaml
```

```bash
oc -n $NS get prometheusrule jvm-gc-alerts -o yaml
```

## Ispezione diretta

Quando le metriche non bastano.

```bash
oc -n $NS exec $POD -c $APP -- jcmd 1 VM.flags
```

```bash
oc -n $NS exec $POD -c $APP -- jcmd 1 GC.heap_info
```

```bash
oc -n $NS exec $POD -c $APP -- jstat -gcutil 1 5000 12
```

Nell'output di `jstat`: `O` che resta sopra 90 dopo i full GC e `FGCT` in crescita costante confermano il leak.

```bash
oc -n $NS exec $POD -c $APP -- jcmd 1 GC.heap_dump /tmp/heap.hprof
```

```bash
oc -n $NS cp $POD:/tmp/heap.hprof ./heap.hprof -c $APP
```

Il dump congela la JVM per tutta la durata dello snapshot. In produzione togli prima la replica dal Service:

```bash
oc -n $NS label pod $POD app-
```
