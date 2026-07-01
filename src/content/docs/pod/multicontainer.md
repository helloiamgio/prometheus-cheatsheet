---
title: Pod multi-container (app + sidecar Istio)
description: Query per scomporre il consumo di risorse quando il pod ha più container (es. app + istio-proxy).
---

Un pod in mesh Istio ha tipicamente **2 container**: quello applicativo e `istio-proxy` (Envoy, injected come sidecar). Le query "per pod" aggregano entrambi: qui sotto le versioni che li **separano**, per capire quanto costa realmente il sidecar rispetto all'app.

## Breakdown per container all'interno dello stesso pod

### CPU per container (app vs istio-proxy)

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{
    namespace!~"kube-.*|openshift-.*",
    container!="", container!="POD"
  }[5m])
)
```

### Memoria per container (app vs istio-proxy)

```promql
sum by (namespace, pod, container) (
  container_memory_working_set_bytes{
    namespace!~"kube-.*|openshift-.*",
    container!="", container!="POD"
  }
)
```

## Isolare solo il sidecar

### CPU solo istio-proxy

```promql
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{container="istio-proxy"}[5m])
)
```

### Memoria solo istio-proxy

```promql
sum by (namespace, pod) (
  container_memory_working_set_bytes{container="istio-proxy"}
)
```

## Isolare solo l'app (escludendo proxy e pause)

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{
    container!="", container!="POD", container!="istio-proxy"
  }[5m])
)
```

## Overhead del sidecar in % rispetto al pod totale

### CPU

```promql
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{container="istio-proxy"}[5m])
)
/
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{container!="", container!="POD"}[5m])
)
```

### Memoria

```promql
sum by (namespace, pod) (
  container_memory_working_set_bytes{container="istio-proxy"}
)
/
sum by (namespace, pod) (
  container_memory_working_set_bytes{container!="", container!="POD"}
)
```

## Top N pod per overhead sidecar (candidati a tuning risorse Envoy)

```promql
topk(10,
  sum by (namespace, pod) (
    rate(container_cpu_usage_seconds_total{container="istio-proxy"}[5m])
  )
)
```

```promql
topk(10,
  sum by (namespace, pod) (
    container_memory_working_set_bytes{container="istio-proxy"}
  )
)
```

## Throttling: capire se il sidecar (o l'app) è sottodimensionato

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_cfs_throttled_seconds_total{
    namespace!~"kube-.*|openshift-.*", container!="", container!="POD"
  }[5m])
)
```

Se `container="istio-proxy"` throttla spesso → i default CPU request/limit iniettati dall'`IstioOperator`/`ServiceMeshControlPlane` (annotazione `sidecar.istio.io/proxyCPU`/`proxyCPULimit`) sono troppo bassi per il traffico reale.

## Requests/limits del sidecar vs uso reale

```promql
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{container="istio-proxy"}[5m])
)
/ on(namespace, pod) group_left
sum by (namespace, pod) (
  kube_pod_container_resource_requests{resource="cpu", container="istio-proxy"}
)
```

```promql
sum by (namespace, pod) (
  container_memory_working_set_bytes{container="istio-proxy"}
)
/ on(namespace, pod) group_left
sum by (namespace, pod) (
  kube_pod_container_resource_requests{resource="memory", container="istio-proxy"}
)
```

## Pattern generico: N container qualsiasi (non solo Istio)

Vale per qualunque sidecar (log-shipper, vault-agent, linkerd-proxy, ecc.): basta sostituire il nome container.

```promql
sum by (namespace, pod, container) (
  rate(container_cpu_usage_seconds_total{
    namespace="<NS>", pod=~"<POD_PREFIX>.*",
    container!="", container!="POD"
  }[5m])
)
```

Poi filtrare/escludere con `container="<nome>"` o `container!="<nome>"` secondo necessità.

## Nota su cardinalità

Aggregare `by (namespace, pod, container)` su cluster grandi con molti pod in mesh alza parecchio la cardinalità delle serie risultanti. Per dashboard "always-on" preferire aggregazioni `by (namespace, container)` e scendere a `pod` solo in fase di drill-down/incident.
