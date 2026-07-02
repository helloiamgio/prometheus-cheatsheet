---
title: etcd & Control Plane
description: Query per la salute di etcd e del control plane, tratte dai runbook pubblici di OpenShift.
---

Fonte primaria: [github.com/openshift/runbooks](https://github.com/openshift/runbooks) — i runbook ufficiali collegati agli alert `runbook_url` che OpenShift spedisce di default. Query riportate in forma originale (sono codice, non prosa) con contesto riassunto.

## Salute etcd

### Latenza fsync su disco (p99) — indicatore #1 di storage lento

```promql
histogram_quantile(0.99,
  sum by (instance, le) (irate(etcd_disk_wal_fsync_duration_seconds_bucket{job="etcd"}[5m]))
)
```

Soglia di riferimento upstream: **10ms** di media sostenuta è già sintomo di disco non adeguato per etcd (serve storage a bassa latenza, tipicamente SSD/NVMe locale, non NFS/SAN condivisa).

### Latenza commit su disco (p99)

```promql
histogram_quantile(0.99,
  sum by (instance, le) (irate(etcd_disk_backend_commit_duration_seconds_bucket{job="etcd"}[5m]))
)
```

### Latenza gRPC complessiva (p99) — sintomo di CPU/disco/rete in sofferenza

```promql
histogram_quantile(0.99,
  sum(rate(grpc_server_handling_seconds_bucket{job=~".*etcd.*", grpc_type="unary"}[5m])) without (grpc_type)
)
```

### % richieste gRPC fallite (per metodo)

```promql
100 * (
  sum without (grpc_type, grpc_code) (
    rate(grpc_server_handled_total{
      job="etcd",
      grpc_code=~"Unknown|FailedPrecondition|ResourceExhausted|Internal|Unavailable|DataLoss|DeadlineExceeded"
    }[5m])
  )
  /
  sum without (grpc_type, grpc_code) (rate(grpc_server_handled_total{job="etcd"}[5m]))
)
```

### Cambi di leader (instabilità del cluster etcd)

```promql
increase(etcd_server_leader_changes_seen_total{job="etcd"}[1h])
```

Più di qualche cambio leader all'ora è anomalo: indica problemi di rete/disco tra i membri del control plane.

### Membri etcd non raggiungibili

```promql
sum(up{job="etcd"} == 0)
```

## Top consumer CPU per namespace — diagnosi standard quando etcd/apiserver sono lenti

Query ufficiale usata nei runbook `etcdGRPCRequestsSlow`/`etcdMembersDown` per capire se un namespace applicativo sta rubando CPU al control plane sullo stesso nodo:

```promql
topk(25, sort_desc(
  sum by (namespace) (
    (
      sum(avg_over_time(pod:container_cpu_usage:sum{container="", pod!=""}[5m])) by (namespace, pod)
      * on(pod, namespace) group_left(node) (node_namespace_pod:kube_pod_info:)
    )
    * on(node) group_left(role) (max by (node) (kube_node_role{role=~".+"}))
  )
))
```

## Overcommit cluster-wide (KubeCPUOvercommit / KubeMemoryOvercommit)

Formula ufficiale kube-prometheus/OpenShift: confronta le requests totali con la capacità **al netto della perdita del nodo più grande** (tolleranza a un node failure).

```promql
# CPU overcommit — vero se il cluster NON tollera la perdita del nodo più carico
sum(namespace_cpu:kube_pod_container_resource_requests:sum{})
/
sum(kube_node_status_allocatable{resource="cpu"})
>
((count(kube_node_status_allocatable{resource="cpu"}) > 1) - 1)
/ count(kube_node_status_allocatable{resource="cpu"})
```

```promql
# Memoria overcommit — stessa logica
sum(namespace_memory:kube_pod_container_resource_requests:sum{})
/
sum(kube_node_status_allocatable{resource="memory"})
>
((count(kube_node_status_allocatable{resource="memory"}) > 1) - 1)
/ count(kube_node_status_allocatable{resource="memory"})
```

> In pratica: se hai N nodi worker, il cluster "tollera" la perdita di 1 nodo solo se le requests totali stanno dentro la capacità degli N-1 nodi rimanenti. L'alert scatta quando questo non è più vero.

## API server — error budget burn (SLO)

Formula semplificata dell'alert `KubeAPIErrorBudgetBurn` (multi-window burn rate, stile Google SRE workbook cap. 5): confronta un burn rate su finestra corta e una lunga per distinguere spike transitori da degradi strutturali.

```promql
# Slow-resource: quota di richieste LIST/GET oltre soglia di latenza (100ms), per resource kind
sum by (resource) (
  rate(apiserver_request_duration_seconds_count{
    job="apiserver", verb=~"LIST|GET", subresource!~"proxy|log|exec", scope="resource"
  }[1d])
)
-
(
  sum by (resource) (
    rate(apiserver_request_duration_seconds_bucket{
      job="apiserver", verb=~"LIST|GET", subresource!~"proxy|log|exec", scope="resource", le="0.1"
    }[1d])
  ) or vector(0)
)
/
scalar(sum(rate(apiserver_request_total{job="apiserver", verb=~"LIST|GET", subresource!~"proxy|log|exec"}[1d])))
```

Se il risultato è dominato da un `resource` specifico (es. un CRD con troppe istanze, watch troppo ampie), quello è il primo sospetto.

### Errori client Kubernetes verso l'API server (rest_client)

```promql
sum by (cluster, instance, job, namespace) (rate(rest_client_requests_total{job="apiserver", code=~"5.."}[5m]))
/
sum by (cluster, instance, job, namespace) (rate(rest_client_requests_total{job="apiserver"}[5m]))
```

## Kubelet — CPU/Mem per nodo (vista "chi occupa il nodo", stile alert KubeletDown/NodeNotReady)

```promql
# CPU per pod sul nodo (usata dal control plane per capire l'origine di un sovraccarico)
sum by (cluster, namespace, pod) (
  rate(container_cpu_usage_seconds_total{job="kubelet", metrics_path="/metrics/cadvisor", image!=""}[5m])
)
* on (cluster, namespace, pod) group_left(node)
  topk by (cluster, namespace, pod) (1, max by (cluster, namespace, pod, node) (kube_pod_info{node!=""}))

# Memoria per pod sul nodo
container_memory_working_set_bytes{job="kubelet", metrics_path="/metrics/cadvisor", image!=""}
* on (cluster, namespace, pod) group_left(node)
  topk by (cluster, namespace, pod) (1, max by (cluster, namespace, pod, node) (kube_pod_info{node!=""}))
```

## Node condition (formula esatta usata dall'alert KubeNodeNotReady / NodePressure)

```promql
kube_node_status_condition{
  job="kube-state-metrics",
  condition=~"(MemoryPressure|DiskPressure|PIDPressure)",
  status="true"
} == 1
```

### Node marcato per rimozione da autoscaler (da escludere dagli alert NotReady)

```promql
(
  kube_node_spec_taint{job="kube-state-metrics", key="node.kubernetes.io/unreachable", effect="NoSchedule"}
  unless ignoring(key, value)
  kube_node_spec_taint{job="kube-state-metrics", key=~"ToBeDeletedByClusterAutoscaler|cloud.google.com/impending-node-termination|aws-node-termination-handler/spot-itn"}
) == 1
```

## Riferimenti

- [openshift/runbooks — etcdGRPCRequestsSlow](https://github.com/openshift/runbooks/blob/master/alerts/cluster-etcd-operator/etcdGRPCRequestsSlow.md)
- [openshift/runbooks — etcdHighNumberOfFailedGRPCRequests](https://github.com/openshift/runbooks/blob/master/alerts/cluster-etcd-operator/etcdHighNumberOfFailedGRPCRequests.md)
- [openshift/runbooks — etcdHighFsyncDurations](https://github.com/openshift/runbooks/blob/master/alerts/cluster-etcd-operator/etcdHighFsyncDurations.md)
- [openshift/runbooks — KubeAPIErrorBudgetBurn](https://github.com/openshift/runbooks/blob/master/alerts/cluster-kube-apiserver-operator/KubeAPIErrorBudgetBurn.md)
- [openshift/cluster-monitoring-operator — control-plane/prometheus-rule.yaml](https://github.com/openshift/cluster-monitoring-operator/blob/main/assets/control-plane/prometheus-rule.yaml)
- [runbooks.prometheus-operator.dev — KubeCPUOvercommit / KubeMemoryOvercommit](https://runbooks.prometheus-operator.dev/runbooks/kubernetes/kubecpuovercommit/)
