import { createTestApp, waitForJob } from '../helpers/app.js';

describe('observability endpoints', () => {
  test('reports scheduler, graph, failure, cycle, and latency metrics', async () => {
    const app = await createTestApp();
    try {
      for (const name of ['api', 'auth']) {
        await app.inject({
          method: 'POST',
          url: '/services',
          payload: {
            name,
            deploymentDurationMs: 1,
            failureMode: name === 'auth' ? 'always' : 'never',
          },
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
        payload: { service: 'auth', dependency: 'api' },
      });
      const accepted = await app.inject({
        method: 'POST',
        url: '/deploy',
        payload: {},
      });
      const jobId = accepted.json<{ id: string }>().id;
      await waitForJob(app, jobId);

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      const output = response.body;

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(output).toContain('deployment_requests_total 1');
      expect(output).toContain('active_deployments 0');
      expect(output).toContain('failed_deployments_total 1');
      expect(output).toContain('dependency_graph_size 2');
      expect(output).toContain('deployment_queue_depth 0');
      expect(output).toContain('cycle_detection_failures_total 1');
      expect(output).toContain('deployment_latency_seconds_count 1');
    } finally {
      await app.close();
    }
  });

  test('distinguishes live process health from metadata readiness', async () => {
    const app = await createTestApp();
    try {
      await app.inject({
        method: 'POST',
        url: '/test/metadata-state',
        payload: { available: false },
      });

      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: 'not_ready',
        live: true,
        ready: false,
        metadata: { available: false },
      });
    } finally {
      await app.close();
    }
  });
});
