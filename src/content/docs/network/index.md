---
title: Traffico pod / interfacce
description: Query di rete a livello pod e nodo.
---

Filtro standard: `namespace!~"kube-.*|openshift-.*"`

### Traffico OUT per pod

```promql
sum by (namespace, pod) (
  rate(container_network_transmit_bytes_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
```

### Traffico IN per pod

```promql
sum by (namespace, pod) (
  rate(container_network_receive_bytes_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
```

### Traffico per pod, breakdown per interfaccia (utile con Multus/secondary NIC)

```promql
sum by (namespace, pod, interface) (
  rate(container_network_transmit_bytes_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
```

> In pod con **Multus/NetworkAttachmentDefinition** (secondary VLAN, SR-IOV) esistono più interfacce (`eth0` primaria OVN-Kubernetes + `net1`, `net2`, ... secondarie). Il breakdown per `interface` è l'unico modo per capire quanto traffico passa sulla NIC secondaria vs quella di pod-network.

### Spike di rete (batch / sync notturni)

```promql
max_over_time(
  rate(container_network_transmit_bytes_total{namespace!~"kube-.*|openshift-.*"}[1m])
[1h:]
)
```

### Errori di rete per pod

```promql
sum by (namespace, pod) (
  rate(container_network_receive_errors_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
+
sum by (namespace, pod) (
  rate(container_network_transmit_errors_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
```

### Packet drop per pod

```promql
sum by (namespace, pod) (
  rate(container_network_receive_packets_dropped_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
+
sum by (namespace, pod) (
  rate(container_network_transmit_packets_dropped_total{namespace!~"kube-.*|openshift-.*"}[5m])
)
```

## Livello nodo (OVN-Kubernetes / OVS)

### Numero di flussi OVS per nodo (ovnkube-node)

```promql
ovs_vswitchd_dp_flows_total
```

### Saturazione banda interfaccia fisica nodo

```promql
rate(node_network_transmit_bytes_total{device!~"lo|veth.*|ovn-k8s-.*"}[5m])
rate(node_network_receive_bytes_total{device!~"lo|veth.*|ovn-k8s-.*"}[5m])
```
