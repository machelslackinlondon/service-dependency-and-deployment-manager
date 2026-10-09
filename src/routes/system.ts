import type { FastifyInstance } from 'fastify';

import type { MetadataStore } from '../metadata/metadata-store.js';
import type { AppMetrics } from '../observability/metrics.js';
import type { AsyncSemaphore } from '../scheduler/async-semaphore.js';

export function registerSystemRoutes(
  app: FastifyInstance,
  metadata: MetadataStore,
  enableTestRoutes: boolean,
  metrics: AppMetrics,
  healthSemaphore: AsyncSemaphore,
): void {
  app.get('/health', async (_request, reply) => {
    const release = await healthSemaphore.acquire();
    try {
      const state = metadata.readiness();
      return reply.status(state.ready ? 200 : 503).send({
        status: state.ready ? 'ok' : 'not_ready',
        live: true,
        ready: state.ready,
        metadata: state,
      });
    } finally {
      release();
    }
  });

  app.get('/metrics', async (_request, reply) =>
    reply
      .type(metrics.registry.contentType)
      .send(await metrics.registry.metrics()),
  );

  if (enableTestRoutes) {
    app.post<{ Body: { readonly available: boolean } }>(
      '/test/metadata-state',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['available'],
            properties: { available: { type: 'boolean' } },
          },
        },
      },
      (request, reply) => {
        metadata.setAvailability(request.body.available);
        return reply.status(204).send();
      },
    );
  }
}
