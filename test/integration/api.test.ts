import { createTestApp, waitForJob } from '../helpers/app.js';

describe('deployment manager API', () => {
  test('registers services/dependencies and returns both valid orders', async () => {
    const app = await createTestApp();
    try {
      for (const name of ['api', 'auth', 'database']) {
        const response = await app.inject({
          method: 'POST',
          url: '/services',
          payload: { name, deploymentDurationMs: 1 },
        });
        expect(response.statusCode).toBe(201);
      }
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/dependencies',
            payload: { service: 'api', dependency: 'auth' },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/dependencies',
            payload: { service: 'auth', dependency: 'database' },
          })
        ).statusCode,
      ).toBe(201);

      for (const algorithm of ['kahn', 'dfs']) {
        const response = await app.inject({
          method: 'GET',
          url: `/deployment-order?algorithm=${algorithm}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          algorithm,
          order: ['database', 'auth', 'api'],
          metadataVersion: 5,
        });
      }
    } finally {
      await app.close();
    }
  });

  test('accepts an asynchronous targeted deployment and exposes status', async () => {
    const app = await createTestApp();
    try {
      for (const name of ['api', 'auth', 'database', 'worker']) {
        await app.inject({
          method: 'POST',
          url: '/services',
          payload: { name, deploymentDurationMs: 1 },
        });
      }
      await app.inject({
        method: 'POST',
        url: '/dependencies',
        payload: { service: 'api', dependency: 'auth' },
      });
      await app.inject({
        method: 'POST',
        url: '/dependencies',
        payload: { service: 'auth', dependency: 'database' },
      });

      const accepted = await app.inject({
        method: 'POST',
        url: '/deploy',
        payload: { targets: ['api'] },
      });

      expect(accepted.statusCode).toBe(202);
      const acceptedBody = accepted.json<{ id: string; status: string }>();
      expect(acceptedBody.status).toBe('queued');
      expect(accepted.headers.location).toBe(
        `/deployments/${acceptedBody.id}`,
      );

      const completed = await waitForJob(app, acceptedBody.id);
      expect(completed.status).toBe('succeeded');
      expect(Object.keys(completed.results as object).sort()).toEqual([
        'api',
        'auth',
        'database',
      ]);
    } finally {
      await app.close();
    }
  });

  test('maps validation, missing resources, duplicates, and cycles', async () => {
    const app = await createTestApp();
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/services',
            payload: { name: 'API', unexpected: true },
          })
        ).statusCode,
      ).toBe(400);

      await app.inject({ method: 'POST', url: '/services', payload: { name: 'api' } });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/services',
            payload: { name: 'api' },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/dependencies',
            payload: { service: 'api', dependency: 'missing' },
          })
        ).statusCode,
      ).toBe(404);

      await app.inject({ method: 'POST', url: '/services', payload: { name: 'auth' } });
      await app.inject({
        method: 'POST',
        url: '/dependencies',
        payload: { service: 'api', dependency: 'auth' },
      });
      const cycle = await app.inject({
        method: 'POST',
        url: '/dependencies',
        payload: { service: 'auth', dependency: 'api' },
      });
      expect(cycle.statusCode).toBe(409);
      expect(cycle.json()).toMatchObject({
        error: { code: 'DEPENDENCY_CYCLE', retryable: false },
      });

      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/deployments/00000000-0000-0000-0000-000000000000',
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  test('fails closed and reports not ready when metadata is unavailable', async () => {
    const app = await createTestApp();
    try {
      const control = await app.inject({
        method: 'POST',
        url: '/test/metadata-state',
        payload: { available: false },
      });
      expect(control.statusCode).toBe(204);

      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(
        503,
      );
      expect(
        (await app.inject({ method: 'GET', url: '/deployment-order' })).statusCode,
      ).toBe(503);
      expect(
        (
          await app.inject({ method: 'POST', url: '/deploy', payload: {} })
        ).statusCode,
      ).toBe(503);
    } finally {
      await app.close();
    }
  });

  test('rejects deployment requests once the bounded queue is saturated', async () => {
    const app = await createTestApp({
      maxActiveJobs: 1,
      maxActiveDeployments: 1,
      maxDeploymentsPerJob: 1,
      maxQueuedDeployments: 1,
      deploymentTimeoutMs: 1_000,
    });
    try {
      await app.inject({
        method: 'POST',
        url: '/services',
        payload: { name: 'slow', deploymentDurationMs: 100 },
      });
      expect(
        (
          await app.inject({ method: 'POST', url: '/deploy', payload: {} })
        ).statusCode,
      ).toBe(202);
      expect(
        (
          await app.inject({ method: 'POST', url: '/deploy', payload: {} })
        ).statusCode,
      ).toBe(202);
      const saturated = await app.inject({
        method: 'POST',
        url: '/deploy',
        payload: {},
      });
      expect(saturated.statusCode).toBe(429);
      expect(saturated.json()).toMatchObject({
        error: { code: 'CAPACITY_EXCEEDED', retryable: true },
      });
    } finally {
      await app.close();
    }
  });

  test('keeps metadata controls disabled by default and exposes required system routes', async () => {
    const app = await createTestApp({}, { enableTestRoutes: false });
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/test/metadata-state',
            payload: { available: false },
          })
        ).statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(
        200,
      );
      expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(
        200,
      );
    } finally {
      await app.close();
    }
  });
});
