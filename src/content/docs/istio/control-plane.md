---
title: Control plane (istiod)
description: Query per la salute del control plane Istio/OSSM (istiod).
---

### CPU/Memoria di istiod

```promql
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="istio-system", pod=~"istiod.*"}[5m]))
sum by (pod) (container_memory_working_set_bytes{namespace="istio-system", pod=~"istiod.*"})
```

### Push totali di configurazione verso i proxy Envoy

```promql
sum(rate(pilot_xds_pushes[5m])) by (type)
```

### Push falliti (config non applicata ai proxy — drift)

```promql
sum(rate(pilot_xds_push_errors[5m])) by (type)
```

### Tempo di propagazione config (p99, dal cambio risorsa al push xDS)

```promql
histogram_quantile(0.99, sum by (le) (rate(pilot_proxy_convergence_time_bucket[5m])))
```

### Numero di proxy connessi a istiod (sanity check scala control plane)

```promql
sum(pilot_xds)
```

### Conflitti di configurazione rilevati (VirtualService/DestinationRule ambigui)

```promql
sum(pilot_total_xds_internal_errors)
```

### Endpoint non pronti nel registry (service discovery)

```promql
pilot_k8s_reg_events{event="Add"}
```

## Salute webhook injection

### Richieste al mutating webhook sidecar-injector (fallite)

```promql
sum(rate(apiserver_admission_webhook_rejection_count{name=~".*sidecar-injector.*"}[5m]))
```
