import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from '@prometheus-io/client';

import type { DeploymentJobStatus } from '../domain/service.js';

export class AppMetrics {
  public readonly registry = new Registry();
  readonly #deploymentRequests = new Counter({
    name: 'deployment_requests_total',
    help: 'Total deployment job requests received.',
    registers: [this.registry],
  });
  readonly #activeDeployments = new Gauge({
    name: 'active_deployments',
    help: 'Number of active service deployment workers.',
    registers: [this.registry],
  });
  readonly #failedDeployments = new Counter({
    name: 'failed_deployments_total',
    help: 'Total deployment jobs with a non-success terminal outcome.',
    registers: [this.registry],
  });
  readonly #graphSize = new Gauge({
    name: 'dependency_graph_size',
    help: 'Number of services in the dependency graph.',
    registers: [this.registry],
  });
  readonly #queueDepth = new Gauge({
    name: 'deployment_queue_depth',
    help: 'Number of deployment jobs waiting in the bounded queue.',
    registers: [this.registry],
  });
  readonly #cycleFailures = new Counter({
    name: 'cycle_detection_failures_total',
    help: 'Total dependency mutations rejected because of a cycle.',
    registers: [this.registry],
  });
  readonly #deploymentLatency = new Histogram({
    name: 'deployment_latency_seconds',
    help: 'End-to-end deployment job latency in seconds.',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  readonly #graphBuildLatency = new Histogram({
    name: 'graph_build_latency_seconds',
    help: 'Dependency graph validation and build latency in seconds.',
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
    registers: [this.registry],
  });
  readonly #topologicalSortLatency = new Histogram({
    name: 'topological_sort_latency_seconds',
    help: 'Topological sort latency in seconds.',
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
    registers: [this.registry],
  });

  public recordDeploymentRequest(): void {
    this.#deploymentRequests.inc();
  }

  public setActiveDeployments(value: number): void {
    this.#activeDeployments.set(value);
  }

  public setGraphSize(value: number): void {
    this.#graphSize.set(value);
  }

  public setQueueDepth(value: number): void {
    this.#queueDepth.set(value);
  }

  public recordCycleFailure(): void {
    this.#cycleFailures.inc();
  }

  public recordJobCompletion(
    status: DeploymentJobStatus,
    durationSeconds: number,
  ): void {
    this.#deploymentLatency.observe(durationSeconds);
    if (status !== 'succeeded') {
      this.#failedDeployments.inc();
    }
  }

  public observeGraphBuild(durationSeconds: number): void {
    this.#graphBuildLatency.observe(durationSeconds);
  }

  public observeTopologicalSort(durationSeconds: number): void {
    this.#topologicalSortLatency.observe(durationSeconds);
  }
}
