import type {
  ServiceDefinition,
  ServiceDeploymentResult,
} from '../../src/domain/service.js';
import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import { AsyncSemaphore } from '../../src/scheduler/async-semaphore.js';
import { BoundedJobQueue } from '../../src/scheduler/bounded-job-queue.js';
import {
  DeploymentScheduler,
  type DeploymentExecutor,
  type DeploymentSnapshot,
} from '../../src/scheduler/deployment-scheduler.js';
import { DeploymentWorker } from '../../src/scheduler/deployment-worker.js';
import { JobStore } from '../../src/scheduler/job-store.js';

function definition(
  name: string,
  failureMode: 'never' | 'always' = 'never',
  deploymentDurationMs = 1,
): ServiceDefinition {
  return Object.freeze({ name, failureMode, deploymentDurationMs });
}

function createSnapshot(
  definitions: readonly ServiceDefinition[],
  edges: readonly { service: string; dependency: string }[],
): DeploymentSnapshot {
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    services: new Map(definitions.map((item) => [item.name, item])),
    graph: DependencyGraph.from(
      definitions.map((item) => item.name),
      edges,
      { maxServices: 20, maxEdges: 20 },
    ),
  };
}

function createScheduler(worker: DeploymentExecutor): {
  scheduler: DeploymentScheduler;
  jobs: JobStore;
  semaphore: AsyncSemaphore;
} {
  const jobs = new JobStore(100);
  const semaphore = new AsyncSemaphore(2);
  return {
    jobs,
    semaphore,
    scheduler: new DeploymentScheduler({
      worker,
      jobs,
      maxDeploymentsPerJob: 2,
      maxActiveJobs: 2,
      queue: new BoundedJobQueue(10),
      globalSemaphore: semaphore,
    }),
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

describe('DeploymentWorker failure handling', () => {
  test('returns a configured deployment failure', async () => {
    const worker = new DeploymentWorker(100);

    await expect(
      worker.deploy(definition('api', 'always'), new AbortController().signal),
    ).resolves.toMatchObject({
      service: 'api',
      status: 'failed',
      error: 'Configured deployment failure',
    });
  });

  test('times out and cancels a slow deployment', async () => {
    const worker = new DeploymentWorker(5);

    await expect(
      worker.deploy(
        definition('api', 'never', 100),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      service: 'api',
      status: 'timed_out',
      error: 'Deployment timed out after 5ms',
    });
  });
});

describe('DeploymentScheduler failure handling', () => {
  test('blocks dependents, completes independent work, and reports partial', async () => {
    const { scheduler, jobs } = createScheduler(new DeploymentWorker(100));
    const snapshot = createSnapshot(
      [definition('api'), definition('auth', 'always'), definition('worker')],
      [{ service: 'api', dependency: 'auth' }],
    );

    const accepted = scheduler.submit(snapshot);
    await waitFor(() => expect(jobs.get(accepted.id).status).toBe('partial'));

    expect(jobs.get(accepted.id).results.get('auth')).toMatchObject({
      status: 'failed',
    });
    expect(jobs.get(accepted.id).results.get('api')).toEqual({
      service: 'api',
      status: 'blocked',
      blockedBy: 'auth',
    });
    expect(jobs.get(accepted.id).results.get('worker')).toMatchObject({
      status: 'succeeded',
    });
  });

  test('classifies a timeout-only failed branch as timed_out', async () => {
    const { scheduler, jobs } = createScheduler(new DeploymentWorker(5));
    const snapshot = createSnapshot(
      [definition('api'), definition('auth', 'never', 100)],
      [{ service: 'api', dependency: 'auth' }],
    );

    const accepted = scheduler.submit(snapshot);
    await waitFor(() => expect(jobs.get(accepted.id).status).toBe('timed_out'));
    expect(jobs.get(accepted.id).results.get('api')).toMatchObject({
      status: 'blocked',
      blockedBy: 'auth',
    });
  });

  test('contains an unexpected worker exception and releases capacity', async () => {
    const throwingWorker: DeploymentExecutor = {
      deploy: () => Promise.reject(new Error('worker exploded')),
    };
    const { scheduler, jobs, semaphore } = createScheduler(throwingWorker);
    const accepted = scheduler.submit(createSnapshot([definition('api')], []));

    await waitFor(() => expect(jobs.get(accepted.id).status).toBe('failed'));
    expect(jobs.get(accepted.id).results.get('api')).toMatchObject({
      status: 'failed',
      error: 'worker exploded',
    });
    expect(semaphore.active).toBe(0);
  });

  test('marks unstarted work blocked after an internal scheduler fault', async () => {
    const snapshot = createSnapshot(
      [definition('api'), definition('auth')],
      [{ service: 'api', dependency: 'auth' }],
    );
    const invalidSnapshot = {
      ...snapshot,
      services: new Map([['api', definition('api')]]),
    };
    const { scheduler, jobs } = createScheduler(new DeploymentWorker(100));

    const accepted = scheduler.submit(invalidSnapshot);
    await waitFor(() => expect(jobs.get(accepted.id).status).toBe('failed'));
    expect(
      [...jobs.get(accepted.id).results.values()].every(
        (result) => result.status === 'blocked',
      ),
    ).toBe(true);
  });

  test('stops accepting jobs while draining in-flight work', async () => {
    let releaseWorker: (() => void) | undefined;
    const controlledWorker: DeploymentExecutor = {
      deploy: (service) =>
        new Promise<ServiceDeploymentResult>((resolve) => {
          releaseWorker = () =>
            resolve({ service: service.name, status: 'succeeded' });
        }),
    };
    const { scheduler, jobs } = createScheduler(controlledWorker);
    const snapshot = createSnapshot([definition('api')], []);
    const accepted = scheduler.submit(snapshot);
    await waitFor(() => expect(releaseWorker).toBeDefined());

    const stopping = scheduler.stop();
    expect(() => scheduler.submit(snapshot)).toThrow(
      'Deployment scheduler is stopping',
    );
    releaseWorker?.();
    await stopping;
    expect(jobs.get(accepted.id).status).toBe('succeeded');
  });
});
