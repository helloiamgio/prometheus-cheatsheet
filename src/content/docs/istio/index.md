---
title: Overview & Envoy sidecar
description: Query base per il consumo risorse del sidecar Envoy e overview del mesh.
---

Ogni pod in mesh ha (con injection automatica) almeno 2 container: quello applicativo + `istio-proxy` (Envoy). Le query di [Pod multi-container](/pod/multicontainer/) sono il punto di partenza per isolare il sidecar; qui sotto le query specifiche del mesh (metriche Envoy/Istio, non cAdvisor).

## Inventario mesh

### Numero pod con sidecar iniettato per namespace

```promql
count by (namespace) (
  container_memory_working_set_bytes{container="istio-proxy"}
)
```

### Pod SENZA sidecar in namespace labelled per injection (drift/injection fallita)

```promql
kube_pod_info{namespace=~"<ns-mesh>.*"}
unless on(namespace, pod)
  count by (namespace, pod) (container_memory_working_set_bytes{container="istio-proxy"})
```

### Versione proxy Envoy in uso (rollout coerente dopo upgrade OSSM)

```promql
count by (namespace, pod, istio_version) (istio_build{component="proxy"})
```

## Consumo risorse per componente mesh (data plane)

### CPU/Mem del sidecar per namespace (aggregato)

```promql
sum by (namespace) (rate(container_cpu_usage_seconds_total{container="istio-proxy"}[5m]))
sum by (namespace) (container_memory_working_set_bytes{container="istio-proxy"})
```

### Top namespace per overhead sidecar totale

```promql
topk(10,
  sum by (namespace) (container_memory_working_set_bytes{container="istio-proxy"})
)
```

## CPU/RAM del sidecar Envoy per un dato namespace, in core/GiB

Domanda tipica: *"quanto CPU/RAM sta usando istio-proxy nel namespace X, in unità leggibili?"* — non in millicore grezzi o byte, ma in core e GiB come li leggi su `oc adm top` o sui dashboard capacity.

### CPU istio-proxy nel namespace — istantaneo, in core

```promql
sum(
  rate(container_cpu_usage_seconds_total{
    namespace="<NAMESPACE>",
    container="istio-proxy"
  }[5m])
)
```

Il risultato di `container_cpu_usage_seconds_total` è già in **secondi di CPU per secondo = core**. Non serve dividere per niente: `1.5` = 1.5 core, `0.25` = 250 millicore.

### Memoria istio-proxy nel namespace — istantanea, in GiB

```promql
sum(
  container_memory_working_set_bytes{
    namespace="<NAMESPACE>",
    container="istio-proxy"
  }
) / 1024 / 1024 / 1024
```

`container_memory_working_set_bytes` è in **byte**: `/ 1024^3` → GiB (base 2, coerente con i `Gi` di Kubernetes/OpenShift). Per GB decimali usa `/ 1e9`.

### Stessa cosa ma per pod (per capire chi pesa di più dentro il namespace)

```promql
# CPU per pod (core)
sum by (pod) (
  rate(container_cpu_usage_seconds_total{namespace="<NAMESPACE>", container="istio-proxy"}[5m])
)

# Memoria per pod (GiB)
sum by (pod) (
  container_memory_working_set_bytes{namespace="<NAMESPACE>", container="istio-proxy"}
) / 1024 / 1024 / 1024
```

### Picco su una finestra (es. 7 giorni) — utile per capacity planning, non solo istantaneo

```promql
# Picco CPU istio-proxy nel namespace (core, finestra 7d, step 5m)
max_over_time(
  sum(
    rate(container_cpu_usage_seconds_total{namespace="<NAMESPACE>", container="istio-proxy"}[5m])
  )
[7d:5m])

# Picco memoria istio-proxy nel namespace (GiB, finestra 7d, step 5m)
max_over_time(
  sum(
    container_memory_working_set_bytes{namespace="<NAMESPACE>", container="istio-proxy"}
  )
[7d:5m]) / 1024 / 1024 / 1024
```

> La divisione per GiB va **fuori** dal `max_over_time`: l'aggregazione lavora sui byte grezzi, la conversione è solo l'ultimo step.

### Confronto: quanto pesa il sidecar rispetto a TUTTO il namespace (app + proxy)

```promql
# % CPU del sidecar sul totale namespace
sum(rate(container_cpu_usage_seconds_total{namespace="<NAMESPACE>", container="istio-proxy"}[5m]))
/
sum(rate(container_cpu_usage_seconds_total{namespace="<NAMESPACE>", container!="", container!="POD"}[5m]))
* 100

# % memoria del sidecar sul totale namespace
sum(container_memory_working_set_bytes{namespace="<NAMESPACE>", container="istio-proxy"})
/
sum(container_memory_working_set_bytes{namespace="<NAMESPACE>", container!="", container!="POD"})
* 100
```

### Multi-namespace in un colpo (dashboard/report)

```promql
# CPU per namespace, solo sidecar, in core
sum by (namespace) (
  rate(container_cpu_usage_seconds_total{container="istio-proxy"}[5m])
)

# Memoria per namespace, solo sidecar, in GiB
sum by (namespace) (
  container_memory_working_set_bytes{container="istio-proxy"}
) / 1024 / 1024 / 1024
```



### Richieste totali per servizio destinazione (RPS)

```promql
sum by (destination_service_name) (
  rate(istio_requests_total{reporter="destination"}[5m])
)
```

### Error rate (5xx) per servizio destinazione

```promql
sum by (destination_service_name) (
  rate(istio_requests_total{reporter="destination", response_code=~"5.."}[5m])
)
/
sum by (destination_service_name) (
  rate(istio_requests_total{reporter="destination"}[5m])
)
```

### Latenza p99 per servizio (da Envoy, non dall'app)

```promql
histogram_quantile(0.99,
  sum by (le, destination_service_name) (
    rate(istio_request_duration_milliseconds_bucket{reporter="destination"}[5m])
  )
)
```

> Confrontare la latenza p99 vista da Envoy con quella vista dall'app stessa: se Envoy misura molto più della app, il collo di bottiglia è nel proxy/rete, non nel codice.
