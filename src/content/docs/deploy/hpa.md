---
title: HPA
description: Query per Horizontal Pod Autoscaler.
---

### HPA impossibilitato a scalare (limitato)

```promql
(kube_horizontalpodautoscaler_spec_max_replicas - kube_horizontalpodautoscaler_status_desired_replicas)
* on (horizontalpodautoscaler, namespace)
  (kube_horizontalpodautoscaler_status_condition{condition="ScalingLimited", status="true"} == 1)
== 0
```

### HPA metriche non disponibili (ScalingActive=false)

```promql
kube_horizontalpodautoscaler_status_condition{status="false", condition="ScalingActive"} == 1
```

### HPA al massimo delle repliche

```promql
(kube_horizontalpodautoscaler_status_desired_replicas >= kube_horizontalpodautoscaler_spec_max_replicas)
and (kube_horizontalpodautoscaler_spec_max_replicas > 1)
and (kube_horizontalpodautoscaler_spec_min_replicas != kube_horizontalpodautoscaler_spec_max_replicas)
```

### HPA sottoutilizzato (fermo al minimo da >3 giorni)

```promql
max(
  quantile_over_time(0.5, kube_horizontalpodautoscaler_status_desired_replicas[1d])
  == kube_horizontalpodautoscaler_spec_min_replicas
) by (horizontalpodautoscaler) > 3
```

### Desired vs Current replicas (drift)

```promql
kube_horizontalpodautoscaler_status_desired_replicas
!= kube_horizontalpodautoscaler_status_current_replicas
```
