import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config.js';

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: { enableTestRoutes?: boolean; now?: () => number } = {},
): Promise<FastifyInstance> {
  const config = Object.freeze({ ...loadConfig({}), ...overrides });
  return buildApp({
    config,
    logger: false,
    enableTestRoutes: options.enableTestRoutes ?? true,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

export async function waitForJob(
  app: FastifyInstance,
  jobId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const response = await app.inject({
      method: 'GET',
      url: `/deployments/${jobId}`,
    });
    const body = response.json<Record<string, unknown>>();
    if (
      ['succeeded', 'partial', 'failed', 'timed_out'].includes(
        body.status as string,
      )
    ) {
      return body;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for deployment ${jobId}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}
