import type { FastifyInstance } from 'fastify';

import type { MetadataStore } from '../metadata/metadata-store.js';

export function registerSystemRoutes(
  app: FastifyInstance,
  metadata: MetadataStore,
  enableTestRoutes: boolean,
): void {
  app.get('/health', (_request, reply) => {
    const state = metadata.readiness();
    return reply.status(state.ready ? 200 : 503).send({
      status: state.ready ? 'ok' : 'not_ready',
      live: true,
      ready: state.ready,
      metadata: state,
    });
  });

  app.get('/metrics', (_request, reply) =>
    reply
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send('# Metrics are initialized by the observability module\n'),
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
