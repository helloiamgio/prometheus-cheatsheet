---
title: API Server & Client
description: Query per salute dell'API server e dei client Kubernetes.
---

### Errori 5xx sull'API server

```promql
sum(rate(apiserver_request_total{job="apiserver", code=~"5.."}[1m])) by (instance, job)
/
sum(rate(apiserver_request_total{job="apiserver"}[1m])) by (instance, job) * 100 > 3
```

### Errori client-side (4xx/5xx) su rest_client

```promql
(
  sum(rate(rest_client_requests_total{code=~"(4|5).."}[1m])) by (instance, job)
  /
  sum(rate(rest_client_requests_total[1m])) by (instance, job)
) * 100 > 1
```

### Latenza API server (p99, escluse WATCH/CONNECT)

```promql
histogram_quantile(0.99,
  sum(rate(apiserver_request_duration_seconds_bucket{verb!~"(?:CONNECT|WATCHLIST|WATCH|PROXY)"}[10m]))
  without (subresource)
) > 1
```

### Certificati client in scadenza (entro 7 giorni)

```promql
apiserver_client_certificate_expiration_seconds_count{job="apiserver"} > 0
and
histogram_quantile(0.01, sum by (job, le) (rate(apiserver_client_certificate_expiration_seconds_bucket{job="apiserver"}[5m]))) < 7*24*60*60
```

### Certificati client in scadenza (entro 24h — urgente)

```promql
apiserver_client_certificate_expiration_seconds_count{job="apiserver"} > 0
and
histogram_quantile(0.01, sum by (job, le) (rate(apiserver_client_certificate_expiration_seconds_bucket{job="apiserver"}[5m]))) < 24*60*60
```

### Rate di richieste per verbo/risorsa (capire chi genera carico)

```promql
sum by (verb, resource) (rate(apiserver_request_total{job="apiserver"}[5m]))
```
