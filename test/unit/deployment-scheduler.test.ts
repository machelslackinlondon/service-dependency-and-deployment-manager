import type {
  ServiceDefinition,
  ServiceDeploymentResult,
} from '../../src/domain/service.js';
import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import {
  DeploymentScheduler,
  type DeploymentExecutor,
  type DeploymentSnapshot,
} from '../../src/scheduler/deployment-scheduler.js';
import { JobStore } from '../../src/scheduler/job-store.js';

class ControlledWorker implements DeploymentExecutor {
  readonly started: string[] = [];
  readonly #releases = new Map<string, () => void>();

  public deploy(
    service: ServiceDefinition,
    signal: AbortSignal,
  ): Promise<ServiceDeploymentResult> {
    void signal;
    this.started.push(service.name);
    return new Promise((resolve) => {
      this.#releases.set(service.name, () => {
        resolve({ service: service.name, status: 'succeeded' });
      });
    });
  }

  public release(service: string): void {
    const release = this.#releases.get(service);
    if (release === undefined) {
      throw new Error(`Service has not started: ${service}`);
    }
    this.#releases.delete(service);
    release();
  }
}

class ImmediateWorker implements DeploymentExecutor {
  public deploy(
    service: ServiceDefinition,
    signal: AbortSignal,
  ): Promise<ServiceDeploymentResult> {
    void signal;
    return Promise.resolve({ service: service.name, status: 'succeeded' });
  }
}

function service(name: string): ServiceDefinition {
  return Object.freeze({
    name,
    deploymentDurationMs: 1,
    failureMode: 'never' as const,
  });
}

function snapshot(): DeploymentSnapshot {
  const definitions = ['api', 'auth', 'database', 'worker'].map(service);
  return {
    version: 7,
    capturedAt: new Date().toISOString(),
    services: new Map(definitions.map((definition) => [definition.name, definition])),
    graph: DependencyGraph.from(
      definitions.map((definition) => definition.name),
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'database' },
      ],
      { maxServices: 10, maxEdges: 10 },
    ),
  };
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1_000;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

describe('DeploymentScheduler', () => {
  test('accepts immediately, gates dependents, and overlaps independent work', async () => {
    const worker = new ControlledWorker();
    const jobs = new JobStore(100);
    const scheduler = new DeploymentScheduler({
      worker,
      jobs,
      maxDeploymentsPerJob: 2,
    });

    const accepted = scheduler.submit(snapshot());

    expect(accepted.status).toBe('queued');
    expect(accepted.metadataVersion).toBe(7);
    await waitFor(() =>
      expect(new Set(worker.started)).toEqual(new Set(['database', 'worker'])),
    );

    worker.release('database');
    await waitFor(() => expect(worker.started).toContain('auth'));
    expect(worker.started).not.toContain('api');

    worker.release('auth');
    await waitFor(() => expect(worker.started).toContain('api'));
    worker.release('worker');
    worker.release('api');

    await waitFor(() => expect(jobs.get(accepted.id).status).toBe('succeeded'));
    expect(
      [...jobs.get(accepted.id).results.values()].map((result) => result.status),
    ).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
  });

  test('targeted jobs include transitive dependencies but exclude unrelated services', async () => {
    const jobs = new JobStore(100);
    const scheduler = new DeploymentScheduler({
      worker: new ImmediateWorker(),
      jobs,
      maxDeploymentsPerJob: 2,
    });

    const accepted = scheduler.submit(snapshot(), ['api']);

    expect([...accepted.results.keys()].sort()).toEqual([
      'api',
      'auth',
      'database',
    ]);
    await waitFor(() => expect(jobs.get(accepted.id).status).toBe('succeeded'));
  });
});
