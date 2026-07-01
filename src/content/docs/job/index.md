---
title: Job / CronJob
description: Query per Job Kubernetes, CronJob e pod short-lived.
---

### Job completati

```promql
kube_job_status_succeeded{namespace!~"kube-.*|openshift-.*"}
```

### Job falliti

```promql
kube_job_status_failed{namespace!~"kube-.*|openshift-.*"}
```

### Job falliti (alert-ready)

```promql
kube_job_status_failed > 0
```

### Job in completamento lento (completions attese non raggiunte)

```promql
kube_job_spec_completions - kube_job_status_succeeded - kube_job_status_failed > 0
```

### Pod short-lived (firma tipica dei job batch)

```promql
count_over_time(
  kube_pod_container_status_running{namespace!~"kube-.*|openshift-.*"}[15m]
) < 15
```

## CronJob

### CronJob sospeso

```promql
kube_cronjob_spec_suspend != 0
```

### CronJob in ritardo (next schedule superato da >1h)

```promql
time() - kube_cronjob_next_schedule_time > 3600
```

### Ultima esecuzione riuscita (timestamp)

```promql
kube_cronjob_status_last_successful_time{namespace!~"kube-.*|openshift-.*"}
```

## CPU/Memoria per job (breakdown per container, utile se il job ha init-container o sidecar)

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{
    namespace="<NS>", pod=~"<JOB_NAME>-.*",
    container!="", container!="POD"
  }[5m])
)
```
