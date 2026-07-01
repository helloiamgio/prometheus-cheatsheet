---
title: Pressure & Disk
description: Query per MemoryPressure, DiskPressure e stato nodi.
---

### Node MemoryPressure

```promql
kube_node_status_condition{condition="MemoryPressure", status="true"} == 1
```

### Node DiskPressure

```promql
kube_node_status_condition{condition="DiskPressure", status="true"} == 1
```

### Node NetworkUnavailable

```promql
kube_node_status_condition{condition="NetworkUnavailable", status="true"} == 1
```

### Node NotReady

```promql
kube_node_status_condition{condition="Ready", status="true"} == 0
```

### Filesystem root quasi pieno

```promql
100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100 > 85
```

### Filesystem containers (/var/lib/containers) quasi pieno

```promql
100 - (node_filesystem_avail_bytes{mountpoint="/var/lib/containers"} / node_filesystem_size_bytes{mountpoint="/var/lib/containers"}) * 100 > 85
```

### Inode quasi esauriti

```promql
100 - (node_filesystem_files_free / node_filesystem_files * 100) > 85
```

### Disk IO saturation (tempo medio in coda/attesa)

```promql
rate(node_disk_io_time_seconds_total[5m])
```

### Predict linear: volume PVC pieno in 4 giorni

```promql
predict_linear(kubelet_volume_stats_available_bytes[6h:5m], 4 * 24 * 3600) < 0
```
