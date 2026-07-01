---
title: Traffic / mTLS / Circuit breaking
description: Query per traffico mesh, mTLS e resilienza (circuit breaker, retry, timeout).
---

## Traffico e routing

### Richieste per coppia source→destination (matrice di traffico)

```promql
sum by (source_workload, destination_workload) (
  rate(istio_requests_total{reporter="destination"}[5m])
)
```

### Richieste per response_flags (capire se sono drop/retry/timeout lato Envoy)

```promql
sum by (response_flags) (
  rate(istio_requests_total{reporter="destination"}[5m])
)
```

Flag comuni da monitorare: `UO` (upstream overflow — circuit breaker aperto), `UF` (upstream connection failure), `UT` (upstream timeout), `NR` (no route configurata).

## mTLS

### Traffico non cifrato/non-mTLS nel mesh (verifica PeerAuthentication STRICT)

```promql
sum by (source_workload, destination_workload, connection_security_policy) (
  rate(istio_requests_total{reporter="destination"}[5m])
) 
```

Filtrare poi `connection_security_policy!="mutual_tls"` per isolare traffico non-mTLS: sintomo di workload fuori mesh o PeerAuthentication troppo permissiva (`PERMISSIVE`/`DISABLE`).

## Circuit breaking / Connection pool

### Connessioni upstream attive per destinazione (saturazione pool)

```promql
envoy_cluster_upstream_cx_active
```

### Richieste rifiutate per overflow del circuit breaker

```promql
rate(envoy_cluster_upstream_rq_pending_overflow[5m])
```

### Retry effettuati per destinazione

```promql
sum by (destination_service_name) (
  rate(istio_requests_total{reporter="destination", response_flags=~".*RR.*"}[5m])
)
```

### Connessioni resettate (RST) verso upstream

```promql
rate(envoy_cluster_upstream_cx_destroy_with_active_rq[5m])
```

## Timeout

### Richieste terminate per timeout (UT flag)

```promql
sum by (destination_service_name) (
  rate(istio_requests_total{reporter="destination", response_flags=~".*UT.*"}[5m])
)
```
