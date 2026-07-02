---
title: OVN-Kubernetes internals
description: Metriche del control plane e datapath OVN-Kubernetes (ovnkube-controller, OVS, libovsdb).
---

Fonte: [ovn-kubernetes.io/observability/metrics](https://ovn-kubernetes.io/observability/metrics/) e [github.com/openshift/ovn-kubernetes](https://github.com/openshift/ovn-kubernetes) (metriche ufficiali del progetto, esposte anche su OCP).

## Leadership & readiness

### Chi è il leader ovnkube-controller / cluster-manager (deve essere sempre 1)

```promql
ovnkube_controller_leader
```

```promql
ovnkube_clustermanager_leader
```

### Nessun leader eletto (situazione anomala — HA compromessa)

```promql
sum(ovnkube_controller_leader) == 0
```

### Tempo di avvio fino a ready (spike dopo restart/upgrade)

```promql
ovnkube_controller_ready_duration_seconds
ovnkube_node_ready_duration_seconds
```

## Retry e sync

### Retry falliti sulla riconciliazione delle risorse (drift di configurazione)

```promql
rate(ovnkube_resource_retry_failures_total[5m])
```

Alla base dell'alert ufficiale `OVNKubernetesResourceRetryFailure`: valori >0 sostenuti indicano che ovnkube-controller non riesce a convergere lo stato desiderato (spesso per conflitti di configurazione o problemi verso apiserver).

### Durata di sync/setup per tipo di risorsa (capire cosa rallenta la riconciliazione)

```promql
ovnkube_controller_sync_duration_seconds
```

### CNI request duration (tempo di attach rete per un pod in creazione — impatta lo startup)

```promql
histogram_quantile(0.99, sum by (le) (rate(ovnkube_node_cni_request_duration_seconds_bucket[5m])))
```

Se questo valore cresce, i pod impiegano più tempo a passare da `ContainerCreating` a `Running`: sintomo tipico di un nodo con troppi pod/secondi o problemi su OVS.

## libovsdb (connessione al database OVN)

### Disconnessioni dal database OVN NB/SB

```promql
rate(ovnkube_master_libovsdb_disconnects_total[5m])
```

### Monitor attivi verso il database

```promql
ovnkube_master_libovsdb_monitors
```

Disconnessioni frequenti = instabilità di rete tra ovnkube-controller e i database OVN, spesso correlata a CPU/rete satura sui control-plane node.

## OVS datapath (dataplane reale sul nodo)

### Numero di flussi OVS installati per nodo (già in questo sito, vedi Network)

```promql
ovs_vswitchd_dp_flows_total
```

### Interfacce OVS in stato reset (link flapping)

```promql
rate(ovs_vswitchd_interface_resets_total[5m])
```

### Pacchetti droppati a livello OVS interface (RX/TX)

```promql
rate(ovs_vswitchd_interface_rx_dropped_total[5m])
rate(ovs_vswitchd_interface_tx_dropped_total[5m])
```

### Errori a livello OVS interface

```promql
rate(ovs_vswitchd_interface_rx_errors_total[5m])
rate(ovs_vswitchd_interface_tx_errors_total[5m])
```

### Collisioni (raro su reti moderne full-duplex, ma da tenere d'occhio su bond/VLAN)

```promql
rate(ovs_vswitchd_interface_collisions_total[5m])
```

> Questi contatori vivono a un livello sotto Multus/pod-network: se `container_network_*` (vedi pagina Network) mostra drop ma queste metriche OVS sono pulite, il problema è più in alto nello stack (es. NetworkPolicy che droppa, non un problema fisico/OVS).

## AdminNetworkPolicy / BaselineAdminNetworkPolicy (se in uso)

```promql
ovnkube_controller_admin_network_policies
ovnkube_controller_baseline_admin_network_policies
```

Numero di oggetti ANP/BANP effettivamente programmati nel database OVN — utile per verificare che una policy applicata via `oc apply` sia arrivata fino al dataplane.
