---
title: Alerting rules pronte all'uso
description: Regole di alerting PromQL per Kubernetes/OpenShift, pronte per Prometheus Rule.
---

Basate su [github.com/helloiamgio/my-prometheus](https://github.com/helloiamgio/my-prometheus). Sostituire soglie secondo l'ambiente (WR/produzione).

## Node

```promql
# Node not ready
kube_node_status_condition{condition="Ready", status="true"} == 0

# Node memory pressure
kube_node_status_condition{condition="MemoryPressure", status="true"} == 1

# Node disk pressure
kube_node_status_condition{condition="DiskPressure", status="true"} == 1

# Node network unavailable
kube_node_status_condition{condition="NetworkUnavailable", status="true"} == 1

# Node out of pod capacity (>90%)
sum by (node) (
  (kube_pod_status_phase{phase="Running"} == 1)
  + on(uid) group_left(node) (0 * kube_pod_info{pod_template_hash=""})
)
/ sum by (node) (kube_node_status_allocatable{resource="pods"}) * 100 > 90
```

## Container / Pod

```promql
# Container OOM killer
(kube_pod_container_status_restarts_total - kube_pod_container_status_restarts_total offset 10m >= 1)
and ignoring (reason)
min_over_time(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}[10m]) == 1

# Container killed (assente da >60s)
time() - container_last_seen > 60

# Container absent
absent(container_last_seen)

# Container CPU alta (>80% del limit)
(sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod, container)
/ sum(container_spec_cpu_quota{container!=""} / container_spec_cpu_period{container!=""}) by (pod, container) * 100) > 80

# Container CPU bassa (<20% del limit — oversized)
(sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod, container)
/ sum(container_spec_cpu_quota{container!=""} / container_spec_cpu_period{container!=""}) by (pod, container) * 100) < 20

# Container memoria alta (>80% del limit)
(sum(container_memory_working_set_bytes{name!=""}) by (instance, name)
/ sum(container_spec_memory_limit_bytes > 0) by (instance, name) * 100) > 80

# Container memoria bassa (<20% del limit — oversized)
(sum(container_memory_working_set_bytes{name!=""}) by (instance, name)
/ sum(container_spec_memory_limit_bytes > 0) by (instance, name) * 100) < 20

# Container inode/volume usage alto
(1 - (sum(container_fs_inodes_free{name!=""}) by (instance) / sum(container_fs_inodes_total) by (instance))) * 100 > 80

# Container throttle rate alto (>25% dei periodi CFS)
sum(increase(container_cpu_cfs_throttled_periods_total{container!=""}[5m])) by (container, pod, namespace)
/ sum(increase(container_cpu_cfs_periods_total[5m])) by (container, pod, namespace) > (25 / 100)

# Pod crash looping (>3 restart/min)
increase(kube_pod_container_status_restarts_total[1m]) > 3

# Pod non healthy (Pending/Unknown/Failed)
sum by (namespace, pod) (kube_pod_status_phase{phase=~"Pending|Unknown|Failed"}) > 0
```

## Workload controller

```promql
# ReplicaSet mismatch
kube_replicaset_spec_replicas != kube_replicaset_status_ready_replicas

# Deployment mismatch
kube_deployment_spec_replicas != kube_deployment_status_replicas_available

# Deployment generation mismatch (rollout non osservato)
kube_deployment_status_observed_generation != kube_deployment_metadata_generation

# StatefulSet down
kube_statefulset_replicas != kube_statefulset_status_replicas_ready > 0

# StatefulSet mismatch
kube_statefulset_status_replicas_ready != kube_statefulset_status_replicas

# StatefulSet generation mismatch
kube_statefulset_status_observed_generation != kube_statefulset_metadata_generation

# StatefulSet update non rollato
max without (revision) (
  kube_statefulset_status_current_revision unless kube_statefulset_status_update_revision
) * (kube_statefulset_replicas != kube_statefulset_status_replicas_updated)

# DaemonSet rollout stuck
kube_daemonset_status_number_ready / kube_daemonset_status_desired_number_scheduled * 100 < 100
or kube_daemonset_status_desired_number_scheduled - kube_daemonset_status_current_number_scheduled > 0

# DaemonSet misscheduled
kube_daemonset_status_number_misscheduled > 0
```

## HPA

```promql
# HPA scale inability
(kube_horizontalpodautoscaler_spec_max_replicas - kube_horizontalpodautoscaler_status_desired_replicas)
* on (horizontalpodautoscaler, namespace)
  (kube_horizontalpodautoscaler_status_condition{condition="ScalingLimited", status="true"} == 1) == 0

# HPA metrics unavailability
kube_horizontalpodautoscaler_status_condition{status="false", condition="ScalingActive"} == 1

# HPA al massimo
(kube_horizontalpodautoscaler_status_desired_replicas >= kube_horizontalpodautoscaler_spec_max_replicas)
and (kube_horizontalpodautoscaler_spec_max_replicas > 1)
and (kube_horizontalpodautoscaler_spec_min_replicas != kube_horizontalpodautoscaler_spec_max_replicas)

# HPA underutilized (fermo al minimo >3 giorni)
max(
  quantile_over_time(0.5, kube_horizontalpodautoscaler_status_desired_replicas[1d])
  == kube_horizontalpodautoscaler_spec_min_replicas
) by (horizontalpodautoscaler) > 3
```

## Job / CronJob

```promql
# Job failed
kube_job_status_failed > 0

# CronJob suspended
kube_cronjob_spec_suspend != 0
```

## Storage

```promql
# PVC pending
kube_persistentvolumeclaim_status_phase{phase="Pending"} == 1

# PV error
kube_persistentvolume_status_phase{phase=~"Failed|Pending", job="kube-state-metrics"} > 0

# Volume quasi pieno (<10%)
kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes * 100 < 10

# Volume pieno previsto in 4 giorni
predict_linear(kubelet_volume_stats_available_bytes[6h:5m], 4 * 24 * 3600) < 0
```

## Control plane / infrastruttura (da runbook ufficiali openshift/runbooks)

```promql
# etcd members down
count(up{job="etcd"} == 0) > 0

# etcd leader changes eccessivi (instabilità)
increase(etcd_server_leader_changes_seen_total{job="etcd"}[1h]) > 3

# etcd gRPC richieste fallite (%)
100 * (
  sum without (grpc_type, grpc_code) (rate(grpc_server_handled_total{job="etcd", grpc_code=~"Unknown|FailedPrecondition|ResourceExhausted|Internal|Unavailable|DataLoss|DeadlineExceeded"}[5m]))
  / sum without (grpc_type, grpc_code) (rate(grpc_server_handled_total{job="etcd"}[5m]))
) > 10

# PersistentVolume errors (KubePersistentVolumeErrors)
kube_persistentvolume_status_phase{phase=~"Failed|Pending"} > 0

# MachineConfigDaemon drain error (nodo bloccato in aggiornamento)
mcd_drain_err > 0

# OVN-Kubernetes retry falliti sulla riconciliazione risorse
rate(ovnkube_resource_retry_failures_total[5m]) > 0

# Nessun leader ovnkube-controller eletto (HA compromessa)
sum(ovnkube_controller_leader) == 0

# Router/Ingress: route con tutti i backend down (503 per gli utenti)
sum by (namespace, route) (haproxy_server_up) == 0
```

## API server

```promql
# API server errori 5xx (>3%)
sum(rate(apiserver_request_total{job="apiserver", code=~"5.."}[1m])) by (instance, job)
/ sum(rate(apiserver_request_total{job="apiserver"}[1m])) by (instance, job) * 100 > 3

# API client errori 4xx/5xx (>1%)
(sum(rate(rest_client_requests_total{code=~"(4|5).."}[1m])) by (instance, job)
/ sum(rate(rest_client_requests_total[1m])) by (instance, job)) * 100 > 1

# API server latenza p99 >1s
histogram_quantile(0.99,
  sum(rate(apiserver_request_duration_seconds_bucket{verb!~"(?:CONNECT|WATCHLIST|WATCH|PROXY)"}[10m])) without (subresource)
) > 1

# Certificato client in scadenza entro 7 giorni
apiserver_client_certificate_expiration_seconds_count{job="apiserver"} > 0
and histogram_quantile(0.01, sum by (job, le) (rate(apiserver_client_certificate_expiration_seconds_bucket{job="apiserver"}[5m]))) < 7*24*60*60

# Certificato client in scadenza entro 24h
apiserver_client_certificate_expiration_seconds_count{job="apiserver"} > 0
and histogram_quantile(0.01, sum by (job, le) (rate(apiserver_client_certificate_expiration_seconds_bucket{job="apiserver"}[5m]))) < 24*60*60
```
