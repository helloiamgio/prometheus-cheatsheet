---
title: Filesystem / PVC / PV
description: Query storage a livello container, PVC e PersistentVolume.
---

## Filesystem container

### Scritture filesystem per pod

```promql
rate(container_fs_writes_bytes_total{namespace!~"kube-.*|openshift-.*"}[5m])
```

### Letture filesystem per pod

```promql
rate(container_fs_reads_bytes_total{namespace!~"kube-.*|openshift-.*"}[5m])
```

### I/O elevato (job / DB / export)

```promql
rate(container_fs_writes_bytes_total{namespace!~"kube-.*|openshift-.*"}[1m])
+
rate(container_fs_reads_bytes_total{namespace!~"kube-.*|openshift-.*"}[1m])
```

### Inode container in esaurimento

```promql
(1 - (sum(container_fs_inodes_free{name!=""}) by (instance) / sum(container_fs_inodes_total) by (instance))) * 100 > 80
```

## PVC

### PVC capacity vs usage

```promql
kubelet_volume_stats_used_bytes{namespace!~"kube-.*|openshift-.*"}
/
kubelet_volume_stats_capacity_bytes{namespace!~"kube-.*|openshift-.*"}
```

### PVC quasi full (>80%)

```promql
(
  kubelet_volume_stats_used_bytes{namespace!~"kube-.*|openshift-.*"}
  /
  kubelet_volume_stats_capacity_bytes{namespace!~"kube-.*|openshift-.*"}
) > 0.8
```

### PVC in Pending

```promql
kube_persistentvolumeclaim_status_phase{phase="Pending"} == 1
```

### Volume quasi pieno (<10% disponibile)

```promql
kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes * 100 < 10
```

### Volume pieno previsto entro 4 giorni

```promql
predict_linear(kubelet_volume_stats_available_bytes[6h:5m], 4 * 24 * 3600) < 0
```

## PersistentVolume

### PV in stato Failed/Pending

```promql
kube_persistentvolume_status_phase{phase=~"Failed|Pending", job="kube-state-metrics"} > 0
```
