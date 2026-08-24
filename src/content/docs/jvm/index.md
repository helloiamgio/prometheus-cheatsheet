---
title: JVM
description: Diagnosticare pause GC, saturazione heap e OOMKill di workload Java su Kubernetes / OpenShift.
sidebar:
  order: 0
---

## Cosa vede Prometheus e cosa no

cAdvisor/kubelet **non vedono dentro la JVM**. Le metriche `container_*` misurano il cgroup, non l'heap. Le metriche `jvm_*` esistono solo se il pod espone un endpoint Micrometer o `jmx_exporter`.

| Sintomo APM | Proxy da metriche container | Affidabilità |
|---|---|---|
| Long garbage-collection time | saturazione memoria vs limit, CPU throttling | indiretta, alta |
| Suspension % in salita | `rate(jvm_gc_pause_seconds_sum[5m])` | diretta, serve exporter |
| Memory leak detected | `deriv(container_memory_working_set_bytes[6h])` | indiretta, media |
| Process crash | `kube_pod_container_status_last_terminated_reason` | diretta |
| Heap old gen piena | `jvm_memory_used_bytes{area="heap"}` | diretta, serve exporter |

Regola pratica: **senza exporter JVM, saturazione memoria e throttling CPU spiegano la quasi totalità degli allarmi GC**. Se entrambi sono bassi il problema è applicativo — allocation rate, oggetti long-lived — e servono i dati JVM.

## Come si usano queste query

Unica variabile da sostituire: **`$NS`**, il namespace.

Ogni query è scritta in due forme.

**1. Tutto il namespace** — default in fase di troubleshooting. Il risultato è raggruppato `by (pod, container)`: incolli, guardi la lista e individui subito chi soffre, senza sapere in anticipo il nome del pod.

**2. Filtro sui pod** — quando hai già il nome dall'alert. Aggiungi il selettore al matcher:

```
pod=~"nome-app-.*"
```

Il filtro `container!="", container!="POD"` è sempre presente: esclude il container `pause` e le serie a livello pod, che altrimenti raddoppiano i valori.

Con sidecar Istio le metriche sommano applicativo ed Envoy. Il raggruppamento `by (pod, container)` li separa automaticamente; per isolare l'uno o l'altro usa `container="istio-proxy"` oppure `container!="istio-proxy"`.

Elenco dei container di un namespace, se serve:

```promql
count by (pod, container) (kube_pod_container_info{namespace="$NS"})
```

## Runbook

Ordine di indagine a partire da un allarme GC dell'APM.

**1. Saturazione memoria vs limit** → [Heap e limit](/jvm/heap-limit/)

Sopra 85% stabile la JVM entra in ciclo di GC continuo ben prima dell'OOMKill: vai al punto 3.

**2. Throttling CPU** → [Heap e limit](/jvm/heap-limit/)

Sopra 25% i thread del collector non ottengono quota CFS e le pause si allungano anche con heap abbondante. Alza il limit CPU prima di toccare la memoria. Molto spesso l'indagine finisce qui.

**3. Leak o undersizing** → [Heap e limit](/jvm/heap-limit/)

Derivata a 6h positiva e costante più minimo settimanale crescente = leak, serve heap dump. Curva piatta ad alto livello = undersizing, basta il rightsizing.

**4. OOMKill e restart** → [Restart / CrashLoop / OOM](/pod/restart-oom/)

Se il container viene ucciso verifica il rapporto `-Xmx` / limit.

**5. Sidecar mesh** → [Multi-container](/pod/multicontainer/)

Envoy concorre al totale del pod ma non all'heap.

**6. Metriche JVM** → [Metriche JVM](/jvm/metriche/)

Se i primi cinque punti sono puliti il problema è dentro l'applicazione.

## Dimensionamento heap

`-Xmx` non dovrebbe superare il **70-75% del limit memoria** del container: il resto serve a metaspace, code cache, thread stack, direct buffer e allocazioni native. Con `-XX:MaxRAMPercentage` il calcolo è automatico ma il default della JVM (25%) è quasi sempre troppo conservativo e spreca metà del limit.

Limit configurati nel namespace, in GiB:

```promql
kube_pod_container_resource_limits{namespace="$NS",resource="memory"} / 1024^3
```

Flag JVM effettivi:

```bash
oc -n $NS get deploy -o custom-columns='NAME:.metadata.name,ENV:.spec.template.spec.containers[*].env[?(@.name=="JAVA_OPTS")].value'
```
