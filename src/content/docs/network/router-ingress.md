---
title: Router / Ingress (HAProxy)
description: Metriche del router HAProxy di OpenShift (Ingress Controller), per route/backend/frontend.
---

Fonte: [github.com/openshift/router](https://github.com/openshift/router/blob/master/pkg/router/metrics/haproxy/haproxy.go) (exporter ufficiale integrato nel router) e documentazione Red Hat sul monitoring dei router.

## Salute dei backend (route)

### Server backend disponibili vs totali (route in "degraded")

```promql
sum by (namespace, route) (haproxy_server_up)
/
count by (namespace, route) (haproxy_server_up)
```

Se il rapporto scende sotto 1, almeno un pod dietro la route è marcato down da HAProxy (health check fallito).

### Server completamente giù per una route (0 backend sani = 503 per gli utenti)

```promql
sum by (namespace, route) (haproxy_server_up) == 0
```

## Traffico e connessioni

### Connessioni correnti per backend

```promql
haproxy_server_current_sessions
```

### Connessioni totali (rate) per backend

```promql
rate(haproxy_server_connections_total[5m])
```

### Richieste HTTP per codice di risposta, per route

```promql
sum by (namespace, route, code) (
  rate(haproxy_server_http_responses_total[5m])
)
```

### Error rate 5xx per route

```promql
sum by (namespace, route) (
  rate(haproxy_server_http_responses_total{code="5xx"}[5m])
)
/
sum by (namespace, route) (
  rate(haproxy_server_http_responses_total[5m])
)
```

## Latenza (attenzione: media, non percentile)

```promql
haproxy_server_http_average_response_latency_milliseconds
haproxy_server_http_average_connect_latency_milliseconds
haproxy_server_http_average_queue_latency_milliseconds
```

> Sono medie calcolate da HAProxy sulle ultime 1024 richieste, **non** istogrammi Prometheus: niente `histogram_quantile()`, e non sono adatte per SLO precisi in tempo reale. Per percentili reali servono i log di accesso di HAProxy (via `ROUTER_SYSLOG_ADDRESS`) processati con un tool esterno (grok-exporter, Fluentd).

### Coda alta (queue latency) = i backend non tengono il ritmo

```promql
topk(10, haproxy_server_http_average_queue_latency_milliseconds)
```

## Capacity del router stesso

### Soglia server-per-router raggiunta (sharding necessario)

Il router smette di esportare metriche per-server oltre una soglia (default 500 backend) per non saturare sé stesso con il carico di scrape:

```bash
oc exec -n openshift-ingress deploy/router-default -- env | grep ROUTER_METRICS_HAPROXY_SERVER_THRESHOLD
```

Quando ci si avvicina alla soglia, la strategia corretta è **shardare** (più IngressController su domini diversi), non alzare la soglia: alzarla aumenta il costo di scrape e può causare timeout Prometheus.

### CPU/Memoria del pod router (cAdvisor, come qualunque pod)

```promql
sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="openshift-ingress", container="router"}[5m]))
sum by (pod) (container_memory_working_set_bytes{namespace="openshift-ingress", container="router"})
```

## Riferimenti

- [github.com/openshift/router — haproxy.go](https://github.com/openshift/router/blob/master/pkg/router/metrics/haproxy/haproxy.go)
- Red Hat Docs — Monitoring and debugging routers (esposizione metriche via porta stats 1936, formato Prometheus)
