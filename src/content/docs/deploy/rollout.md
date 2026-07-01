---
title: Rollout & Availability
description: Query per capire disponibilità durante rollout/deploy.
---

### Pod non disponibili durante un rollout

```promql
kube_deployment_status_replicas_available{namespace!~"kube-.*|openshift-.*"}
< kube_deployment_spec_replicas{namespace!~"kube-.*|openshift-.*"}
```

### Pod in stato Terminating a lungo (stuck)

```promql
kube_pod_deletion_timestamp{namespace!~"kube-.*|openshift-.*"} > 0
and
(time() - kube_pod_deletion_timestamp) > 300
```

### Availability: % pod Ready sul totale desired

```promql
sum by (namespace, deployment) (kube_deployment_status_replicas_available)
/
sum by (namespace, deployment) (kube_deployment_spec_replicas) * 100
```

> Per il timestamp esatto dell'ultimo rollout completato PromQL da solo non basta: meglio correlare con `oc rollout status` / eventi della pipeline CI.
