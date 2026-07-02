---
title: Fonti & Riferimenti
description: Fonti pubbliche e KCS Red Hat usate per costruire questo sito.
---

## Fonti pubbliche (contenuto integrale usato)

- [github.com/openshift/runbooks](https://github.com/openshift/runbooks) — runbook ufficiali collegati agli alert `runbook_url` spediti di default con OpenShift (etcd, API server, kubelet, nodi, HPA, job).
- [github.com/openshift/cluster-monitoring-operator](https://github.com/openshift/cluster-monitoring-operator) — sorgente delle `PrometheusRule` effettivamente installate su ogni cluster OCP (`assets/control-plane/prometheus-rule.yaml`).
- [runbooks.prometheus-operator.dev](https://runbooks.prometheus-operator.dev/) — runbook upstream kube-prometheus (KubeCPUOvercommit, KubeMemoryOvercommit, KubeAPIErrorBudgetBurn).
- [docs.redhat.com — OpenShift Monitoring](https://docs.redhat.com/en/documentation/openshift_container_platform/latest/html/monitoring/index) — querying/managing metrics, Metrics UI.
- [docs.openshift.com/rosa — Service Mesh Performance & Scalability](https://docs.openshift.com/rosa/service_mesh/v2x/ossm-performance-scalability.html) e [maistra.io/docs/ossm-performance-scalability](https://maistra.io/docs/ossm-performance-scalability) — dati ufficiali di sizing Envoy/istiod.
- [ovn-kubernetes.io/observability/metrics](https://ovn-kubernetes.io/observability/metrics/) e [github.com/openshift/ovn-kubernetes](https://github.com/openshift/ovn-kubernetes) — metriche ufficiali del control plane OVN-Kubernetes.
- [github.com/openshift/router](https://github.com/openshift/router/blob/master/pkg/router/metrics/haproxy/haproxy.go) — exporter HAProxy integrato nel router OpenShift.

## Soluzioni KCS Red Hat pertinenti (richiedono subscription attiva)

Il contenuto completo di queste soluzioni è dietro login (`access.redhat.com`) e non è riproducibile qui per policy Red Hat. Titolo e link per chi ha accesso:

- [Solution 6024501](https://access.redhat.com/solutions/6024501) — *How to check pods resource consumption by namespace using Prometheus query?*
- [Solution 6800531](https://access.redhat.com/solutions/6800531) — *How to check memory and CPU requests of nodes using Prometheus query in OpenShift Container Platform 4.*
- [Solution 6303281](https://access.redhat.com/solutions/6303281) — *How to set resource limit for istio-proxy?*
- [Article 7067755](https://access.redhat.com/articles/7067755) — *How to use Prometheus Query Language (PromQL) in OpenShift.*

Se hai una subscription attiva, valgono come conferma/dettaglio aggiuntivo rispetto alle query equivalenti già presenti in questo sito (derivate dai runbook pubblici sopra, che coprono gli stessi casi d'uso).

## Repository personali

- [github.com/helloiamgio/my-prometheus](https://github.com/helloiamgio/my-prometheus)
- [openshift-cheatsheet.pages.dev/prometheus-utils](https://openshift-cheatsheet.pages.dev/prometheus-utils/)
