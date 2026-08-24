// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Prometheus Cheatsheet',
			description: 'Query PromQL per Kubernetes / OpenShift, organizzate per oggetto (Pod, Deploy, Node, Job, Network, Storage, Istio).',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/helloiamgio/my-prometheus' },
			],
			editLink: {
				baseUrl: 'https://github.com/helloiamgio/prometheus-cheatsheet/edit/main/',
			},
			customCss: [
				'./src/styles/custom.css',
			],
			expressiveCode: {
				themes: ['github-dark-default'],
				shiki: {
					langAlias: {
						promql: 'python',
					},
				},
			},
			logo: {
				src: './src/assets/logo.svg',
			},
			sidebar: [
				{
					label: 'Overview',
					items: [
						{ label: 'Home', slug: 'index' },
						{ label: 'Fonti & Riferimenti', slug: 'fonti' },
					],
				},
				{
					label: 'Pod / Container',
					items: [
						{ label: 'CPU & Memoria per pod/container', slug: 'pod' },
						{ label: 'Multi-container (app + sidecar)', slug: 'pod/multicontainer' },
						{ label: 'Restart / CrashLoop / OOM', slug: 'pod/restart-oom' },
					],
				},
				{
					label: 'Deploy / Workload',
					items: [
						{ label: 'Deployment / ReplicaSet / StatefulSet / DaemonSet', slug: 'deploy' },
						{ label: 'HPA', slug: 'deploy/hpa' },
						{ label: 'Rollout & Availability', slug: 'deploy/rollout' },
					],
				},
				{
					label: 'Node',
					items: [
						{ label: 'CPU / RAM / Capacity per nodo', slug: 'node' },
						{ label: 'Node NotReady - Runbook', slug: 'node/notready-runbook' },
						{ label: 'Pressure & Disk', slug: 'node/pressure' },
						{ label: 'etcd & Control Plane', slug: 'node/etcd-control-plane' },
					],
				},
				{
					label: 'Job / CronJob',
					items: [
						{ label: 'Job / CronJob', slug: 'job' },
					],
				},
				{
					label: 'Network',
					items: [
						{ label: 'Traffico pod / interfacce', slug: 'network' },
						{ label: 'DNS / CoreDNS', slug: 'network/dns' },
						{ label: 'API Server & Client', slug: 'network/apiserver' },
						{ label: 'OVN-Kubernetes internals', slug: 'network/ovn' },
						{ label: 'Router / Ingress (HAProxy)', slug: 'network/router-ingress' },
					],
				},
				{
					label: 'Storage',
					items: [
						{ label: 'Filesystem / PVC / PV', slug: 'storage' },
					],
				},
				{
					label: 'Namespace & Cluster Capacity',
					items: [
						{ label: 'Consumi per namespace', slug: 'capacity/namespace' },
						{ label: 'Capacity cluster / nodi worker', slug: 'capacity' },
					],
				},
				{
					label: 'Istio / Service Mesh',
					items: [
						{ label: 'Overview & Envoy sidecar', slug: 'istio' },
						{ label: 'Traffic / mTLS / Circuit breaking', slug: 'istio/traffic' },
						{ label: 'Control plane (istiod)', slug: 'istio/control-plane' },
					],
				},
                                				{
					label: 'JVM / Java',
					items: [
						{ label: 'Panoramica & Runbook GC', slug: 'jvm' },
						{ label: 'Heap, limit & throttling', slug: 'jvm/heap-limit' },
						{ label: 'Metriche JVM & Alerting', slug: 'jvm/metriche' },
					],
				},
				{
					label: 'Alert Rules',
					items: [
						{ label: "Alerting rules pronte all'uso", slug: 'alerts' },
					],
				},
			],
		}),
	],
});
