import { randomUUID } from 'node:crypto';

import type {
  DeploymentJob,
  DeploymentJobStatus,
  ServiceDeploymentResult,
} from '../domain/service.js';
import { NotFoundError } from '../errors.js';

interface MutableJob {
  readonly id: string;
  status: DeploymentJobStatus;
  readonly metadataVersion: number;
  readonly requestedTargets: readonly string[];
  readonly createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  readonly results: Map<string, ServiceDeploymentResult>;
}

export interface CreateJobInput {
  readonly metadataVersion: number;
  readonly requestedTargets: readonly string[];
  readonly selectedServices: readonly string[];
}

export class JobStore {
  readonly #jobs = new Map<string, MutableJob>();

  public constructor(private readonly retention: number) {}

  public create(input: CreateJobInput): DeploymentJob {
    while (this.#jobs.size >= this.retention) {
      const oldest = this.#jobs.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#jobs.delete(oldest);
    }

    const job: MutableJob = {
      id: randomUUID(),
      status: 'queued',
      metadataVersion: input.metadataVersion,
      requestedTargets: Object.freeze([...input.requestedTargets]),
      createdAt: new Date().toISOString(),
      results: new Map(
        [...input.selectedServices]
          .sort()
          .map((service) => [service, { service, status: 'pending' }]),
      ),
    };
    this.#jobs.set(job.id, job);
    return this.#snapshot(job);
  }

  public get(id: string): DeploymentJob {
    return this.#snapshot(this.#find(id));
  }

  public markRunning(id: string): void {
    const job = this.#find(id);
    job.status = 'running';
    job.startedAt = new Date().toISOString();
  }

  public setResult(id: string, result: ServiceDeploymentResult): void {
    const job = this.#find(id);
    if (!job.results.has(result.service)) {
      throw new NotFoundError(`Service is not part of job: ${result.service}`);
    }
    job.results.set(result.service, Object.freeze({ ...result }));
  }

  public complete(id: string, status: DeploymentJobStatus): void {
    const job = this.#find(id);
    job.status = status;
    job.finishedAt = new Date().toISOString();
  }

  #find(id: string): MutableJob {
    const job = this.#jobs.get(id);
    if (job === undefined) {
      throw new NotFoundError(`Deployment job not found: ${id}`);
    }
    return job;
  }

  #snapshot(job: MutableJob): DeploymentJob {
    return Object.freeze({
      id: job.id,
      status: job.status,
      metadataVersion: job.metadataVersion,
      requestedTargets: job.requestedTargets,
      createdAt: job.createdAt,
      ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
      results: new Map(job.results),
    });
  }
}
