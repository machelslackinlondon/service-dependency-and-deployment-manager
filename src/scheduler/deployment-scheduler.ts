import type {
  DeploymentJob,
  ServiceDefinition,
  ServiceDeploymentResult,
} from '../domain/service.js';
import {
  CapacityError,
  NotFoundError,
  SchedulerUnavailableError,
} from '../errors.js';
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
  readonly observer?: DeploymentSchedulerObserver;
}

export interface DeploymentSchedulerObserver {
  stateChanged(activeDeployments: number, queueDepth: number): void;
  jobAccepted(job: DeploymentJob): void;
  jobStarted(jobId: string): void;
  serviceCompleted(jobId: string, result: ServiceDeploymentResult): void;
  jobCompleted(job: DeploymentJob, durationSeconds: number): void;
  schedulerFailed(jobId: string, error: unknown): void;
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
  readonly #observer: DeploymentSchedulerObserver | undefined;
  readonly #running = new Set<Promise<void>>();
  #activeJobs = 0;
  #accepting = true;

  public constructor(options: DeploymentSchedulerOptions) {
    this.#worker = options.worker;
    this.#jobs = options.jobs;
    this.#maxDeploymentsPerJob = options.maxDeploymentsPerJob;
    this.#maxActiveJobs = options.maxActiveJobs;
    this.#queue = options.queue;
    this.#globalSemaphore = options.globalSemaphore;
    this.#observer = options.observer;
  }

  public start(): void {
    this.#accepting = true;
    this.#dispatch();
  }

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
    if (!this.#accepting) {
      throw new SchedulerUnavailableError();
    }
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
    this.#observer?.jobAccepted(job);
    this.#notifyState();
    this.#dispatch();
    return job;
  }

  public async stop(): Promise<void> {
    this.#accepting = false;
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
      const startedAt = process.hrtime.bigint();
      this.#observer?.jobStarted(queued.jobId);
      this.#notifyState();
      const running = this.#runJob(
        queued.jobId,
        queued.snapshot,
        queued.selected,
      )
        .catch((error: unknown) => {
          this.#observer?.schedulerFailed(queued.jobId, error);
          this.#handleSchedulerFailure(queued.jobId, error);
        })
        .finally(() => {
          const durationSeconds =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
          this.#observer?.jobCompleted(
            this.#jobs.get(queued.jobId),
            durationSeconds,
          );
          this.#running.delete(running);
          this.#activeJobs -= 1;
          this.#notifyState();
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
    const blocked = new Set<string>();

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
      this.#observer?.serviceCompleted(jobId, completed.result);

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
      } else {
        this.#blockDependents(
          jobId,
          snapshot.graph,
          selected,
          completed.service,
          blocked,
        );
      }
    }

    this.#jobs.complete(jobId, this.#classify(jobId));
  }

  async #deploy(
    definition: ServiceDefinition,
  ): Promise<ServiceDeploymentResult> {
    const release = await this.#globalSemaphore.acquire();
    this.#notifyState();
    try {
      try {
        return await this.#worker.deploy(
          definition,
          new AbortController().signal,
        );
      } catch (error) {
        return {
          service: definition.name,
          status: 'failed',
          error: errorMessage(error),
        };
      }
    } finally {
      release();
      this.#notifyState();
    }
  }

  #blockDependents(
    jobId: string,
    graph: DependencyGraph,
    selected: ReadonlySet<string>,
    failedService: string,
    blocked: Set<string>,
  ): void {
    const queue = [...graph.dependentsOf(failedService)];
    for (let head = 0; head < queue.length; head += 1) {
      const dependent = queue[head];
      if (
        dependent === undefined ||
        !selected.has(dependent) ||
        blocked.has(dependent)
      ) {
        continue;
      }
      blocked.add(dependent);
      this.#jobs.setResult(jobId, {
        service: dependent,
        status: 'blocked',
        blockedBy: failedService,
      });
      queue.push(...graph.dependentsOf(dependent));
    }
  }

  #classify(jobId: string): 'succeeded' | 'partial' | 'failed' | 'timed_out' {
    const results = [...this.#jobs.get(jobId).results.values()];
    if (results.every((result) => result.status === 'succeeded')) {
      return 'succeeded';
    }
    if (results.some((result) => result.status === 'succeeded')) {
      return 'partial';
    }
    const directFailures = results.filter(
      (result) => result.status === 'failed' || result.status === 'timed_out',
    );
    if (
      directFailures.length > 0 &&
      directFailures.every((result) => result.status === 'timed_out')
    ) {
      return 'timed_out';
    }
    return 'failed';
  }

  #handleSchedulerFailure(jobId: string, error: unknown): void {
    const job = this.#jobs.get(jobId);
    for (const result of job.results.values()) {
      if (result.status === 'pending' || result.status === 'running') {
        this.#jobs.setResult(jobId, {
          service: result.service,
          status: 'blocked',
          error: `Scheduler failure: ${errorMessage(error)}`,
        });
      }
    }
    this.#jobs.complete(jobId, 'failed');
  }

  #notifyState(): void {
    this.#observer?.stateChanged(
      this.#globalSemaphore.active,
      this.#queue.depth,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown scheduler failure';
}
