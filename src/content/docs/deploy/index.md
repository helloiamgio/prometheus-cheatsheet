---
title: Deployment / ReplicaSet / StatefulSet / DaemonSet
description: Query sullo stato dei workload controller.
---

## Deployment

### Replicas mismatch (spec vs available)

```promql
kube_deployment_spec_replicas != kube_deployment_status_replicas_available
```

### Generation mismatch (rollout non completato/osservato)

```promql
kube_deployment_status_observed_generation != kube_deployment_metadata_generation
```

## ReplicaSet

### Replicas mismatch

```promql
kube_replicaset_spec_replicas != kube_replicaset_status_ready_replicas
```

## StatefulSet

### Down (ready < desired)

```promql
kube_statefulset_replicas != kube_statefulset_status_replicas_ready > 0
```

### Replicas mismatch

```promql
kube_statefulset_status_replicas_ready != kube_statefulset_status_replicas
```

### Generation mismatch

```promql
kube_statefulset_status_observed_generation != kube_statefulset_metadata_generation
```

### Update non rollato su tutte le repliche

```promql
max without (revision) (
  kube_statefulset_status_current_revision
  unless kube_statefulset_status_update_revision
)
* (kube_statefulset_replicas != kube_statefulset_status_replicas_updated)
```

## DaemonSet

### Rollout bloccato

```promql
kube_daemonset_status_number_ready
/ kube_daemonset_status_desired_number_scheduled * 100 < 100
or
kube_daemonset_status_desired_number_scheduled - kube_daemonset_status_current_number_scheduled > 0
```

### Misscheduled (pod schedulati dove non dovrebbero)

```promql
kube_daemonset_status_number_misscheduled > 0
```

## CPU/Memoria aggregati per workload (via label del pod)

Per aggregare al livello Deployment serve joinare `kube_pod_info`/`kube_replicaset_owner` con le metriche cAdvisor. Esempio via `owner_kind`/`owner_name` di `kube_pod_owner`:

```promql
sum by (namespace, owner_name) (
  rate(container_cpu_usage_seconds_total{container!="", container!="POD"}[5m])
)
* on(namespace, pod) group_left(owner_name)
  kube_pod_owner{owner_kind="ReplicaSet"}
```

> In pratica: più veloce filtrare per `pod=~"<deploy-name>-.*"` in ambienti WR quando i nomi sono prevedibili (naming convention del chart/deployment).
