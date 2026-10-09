import type {
  DeploymentJob,
  ServiceDefinition,
  ServiceDeploymentResult,
} from '../domain/service.js';
import { NotFoundError } from '../errors.js';
import type { DependencyGraph } from '../graph/dependency-graph.js';
import type { JobStore } from './job-store.js';

export interface DeploymentSnapshot {
  readonly version: number;
  readonly capturedAt: string;
  readonly services: ReadonlyMap<string, ServiceDefinition>;
  readonly graph: DependencyGraph;
}

export interface DeploymentExecutor {
  deploy(
    service: ServiceDefinition,
    signal: AbortSignal,
  ): Promise<ServiceDeploymentResult>;
}

export interface DeploymentSchedulerOptions {
  readonly worker: DeploymentExecutor;
  readonly jobs: JobStore;
  readonly maxDeploymentsPerJob: number;
}

export class DeploymentScheduler {
  readonly #worker: DeploymentExecutor;
  readonly #jobs: JobStore;
  readonly #maxDeploymentsPerJob: number;
  readonly #running = new Set<Promise<void>>();

  public constructor(options: DeploymentSchedulerOptions) {
    this.#worker = options.worker;
    this.#jobs = options.jobs;
    this.#maxDeploymentsPerJob = options.maxDeploymentsPerJob;
  }

  public start(): void {}

  public submit(
    snapshot: DeploymentSnapshot,
    targets?: readonly string[],
  ): DeploymentJob {
    const requestedTargets = targets ?? snapshot.graph.services();
    const selected = snapshot.graph.dependencyClosure(requestedTargets);
    const job = this.#jobs.create({
      metadataVersion: snapshot.version,
      requestedTargets,
      selectedServices: [...selected],
    });

    const running = Promise.resolve()
      .then(() => this.#runJob(job.id, snapshot, selected))
      .catch(() => {
        this.#jobs.complete(job.id, 'failed');
      })
      .finally(() => {
        this.#running.delete(running);
      });
    this.#running.add(running);
    return job;
  }

  public async stop(): Promise<void> {
    await Promise.allSettled([...this.#running]);
  }

  async #runJob(
    jobId: string,
    snapshot: DeploymentSnapshot,
    selected: ReadonlySet<string>,
  ): Promise<void> {
    this.#jobs.markRunning(jobId);
    const remainingDependencies = new Map<string, number>();
    for (const service of selected) {
      const count = snapshot.graph
        .dependenciesOf(service)
        .filter((dependency) => selected.has(dependency)).length;
      remainingDependencies.set(service, count);
    }

    const ready = [...selected]
      .filter((service) => remainingDependencies.get(service) === 0)
      .sort();
    let readyHead = 0;
    const active = new Map<
      string,
      Promise<{ service: string; result: ServiceDeploymentResult }>
    >();

    while (readyHead < ready.length || active.size > 0) {
      while (
        readyHead < ready.length &&
        active.size < this.#maxDeploymentsPerJob
      ) {
        const service = ready[readyHead];
        readyHead += 1;
        if (service === undefined) {
          continue;
        }
        const definition = snapshot.services.get(service);
        if (definition === undefined) {
          throw new NotFoundError(`Service metadata not found: ${service}`);
        }
        this.#jobs.setResult(jobId, { service, status: 'running' });
        const promise = this.#worker
          .deploy(definition, new AbortController().signal)
          .then((result) => ({ service, result }));
        active.set(service, promise);
      }

      if (active.size === 0) {
        break;
      }
      const completed = await Promise.race(active.values());
      active.delete(completed.service);
      this.#jobs.setResult(jobId, completed.result);

      if (completed.result.status === 'succeeded') {
        for (const dependent of snapshot.graph.dependentsOf(completed.service)) {
          if (!selected.has(dependent)) {
            continue;
          }
          const remaining = remainingDependencies.get(dependent);
          if (remaining === undefined) {
            throw new Error('Scheduler dependency count is inconsistent');
          }
          const next = remaining - 1;
          remainingDependencies.set(dependent, next);
          if (next === 0) {
            ready.push(dependent);
          }
        }
      }
    }

    this.#jobs.complete(jobId, 'succeeded');
  }
}
