import type {
  DeploymentJob,
  ServiceDefinition,
  ServiceDeploymentResult,
} from '../domain/service.js';
import { CapacityError, NotFoundError } from '../errors.js';
import type { DependencyGraph } from '../graph/dependency-graph.js';
import type { AsyncSemaphore } from './async-semaphore.js';
import type { BoundedJobQueue } from './bounded-job-queue.js';
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
  readonly maxActiveJobs: number;
  readonly queue: BoundedJobQueue<QueuedDeployment>;
  readonly globalSemaphore: AsyncSemaphore;
}

interface QueuedDeployment {
  readonly jobId: string;
  readonly snapshot: DeploymentSnapshot;
  readonly selected: ReadonlySet<string>;
}

export class DeploymentScheduler {
  readonly #worker: DeploymentExecutor;
  readonly #jobs: JobStore;
  readonly #maxDeploymentsPerJob: number;
  readonly #maxActiveJobs: number;
  readonly #queue: BoundedJobQueue<QueuedDeployment>;
  readonly #globalSemaphore: AsyncSemaphore;
  readonly #running = new Set<Promise<void>>();
  #activeJobs = 0;

  public constructor(options: DeploymentSchedulerOptions) {
    this.#worker = options.worker;
    this.#jobs = options.jobs;
    this.#maxDeploymentsPerJob = options.maxDeploymentsPerJob;
    this.#maxActiveJobs = options.maxActiveJobs;
    this.#queue = options.queue;
    this.#globalSemaphore = options.globalSemaphore;
  }

  public start(): void {}

  public get queueDepth(): number {
    return this.#queue.depth;
  }

  public get activeJobs(): number {
    return this.#activeJobs;
  }

  public submit(
    snapshot: DeploymentSnapshot,
    targets?: readonly string[],
  ): DeploymentJob {
    const requestedTargets = targets ?? snapshot.graph.services();
    const selected = snapshot.graph.dependencyClosure(requestedTargets);
    if (this.#queue.isFull) {
      throw new CapacityError('Deployment queue capacity exceeded');
    }
    const job = this.#jobs.create({
      metadataVersion: snapshot.version,
      requestedTargets,
      selectedServices: [...selected],
    });

    this.#queue.enqueue({ jobId: job.id, snapshot, selected });
    this.#dispatch();
    return job;
  }

  public async stop(): Promise<void> {
    while (this.#running.size > 0 || this.#queue.depth > 0) {
      await Promise.allSettled([...this.#running]);
    }
  }

  #dispatch(): void {
    while (this.#activeJobs < this.#maxActiveJobs) {
      const queued = this.#queue.dequeue();
      if (queued === undefined) {
        return;
      }
      this.#activeJobs += 1;
      const running = this.#runJob(
        queued.jobId,
        queued.snapshot,
        queued.selected,
      )
        .catch(() => {
          this.#jobs.complete(queued.jobId, 'failed');
        })
        .finally(() => {
          this.#running.delete(running);
          this.#activeJobs -= 1;
          this.#dispatch();
        });
      this.#running.add(running);
    }
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
        const promise = this.#deploy(definition)
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

  async #deploy(
    definition: ServiceDefinition,
  ): Promise<ServiceDeploymentResult> {
    const release = await this.#globalSemaphore.acquire();
    try {
      return await this.#worker.deploy(
        definition,
        new AbortController().signal,
      );
    } finally {
      release();
    }
  }
}
