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

## Traffico visto da Envoy (metriche `istio_*`, non cAdvisor)

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
