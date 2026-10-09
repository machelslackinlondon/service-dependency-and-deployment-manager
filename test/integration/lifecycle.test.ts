import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createTestApp } from '../helpers/app.js';

describe('application lifecycle', () => {
  test('never enables test controls in production', async () => {
    const config = loadConfig({ NODE_ENV: 'production' });

    await expect(
      buildApp({ config, logger: false, enableTestRoutes: true }),
    ).rejects.toThrow('Test routes cannot be enabled in production');
  });

  test('drains an in-flight deployment within the shutdown grace period', async () => {
    const app = await createTestApp({ shutdownGraceMs: 500 });
    await app.inject({
      method: 'POST',
      url: '/services',
      payload: { name: 'api', deploymentDurationMs: 20 },
    });
    await app.inject({ method: 'POST', url: '/deploy', payload: {} });

    await expect(app.close()).resolves.toBeUndefined();
  });

  test('fails shutdown after the configured grace period', async () => {
    const app = await createTestApp({
      shutdownGraceMs: 5,
      deploymentTimeoutMs: 1_000,
    });
    await app.inject({
      method: 'POST',
      url: '/services',
      payload: { name: 'slow', deploymentDurationMs: 100 },
    });
    await app.inject({ method: 'POST', url: '/deploy', payload: {} });

    await expect(app.close()).rejects.toThrow(
      'Scheduler shutdown exceeded 5ms grace period',
    );
    await new Promise((resolve) => setTimeout(resolve, 110));
  });
});
