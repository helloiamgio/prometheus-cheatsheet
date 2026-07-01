---
title: DNS / CoreDNS
description: Query per la salute di CoreDNS e risoluzione DNS interna.
---

### Richieste DNS totali per zona/protocollo

```promql
sum by (zone, proto) (rate(coredns_dns_requests_total[5m]))
```

### Errori DNS (SERVFAIL/NXDOMAIN oltre soglia)

```promql
sum by (rcode) (rate(coredns_dns_responses_total{rcode=~"SERVFAIL|REFUSED"}[5m]))
```

### Latenza risoluzione DNS (p99)

```promql
histogram_quantile(0.99, sum by (le) (rate(coredns_dns_request_duration_seconds_bucket[5m])))
```

### Cache hit ratio CoreDNS

```promql
sum(rate(coredns_cache_hits_total[5m])) / sum(rate(coredns_cache_requests_total[5m]))
```

### Pod CoreDNS non Ready

```promql
kube_pod_status_ready{namespace="openshift-dns", condition="false"}
```
