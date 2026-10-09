import type { FastifyInstance } from 'fastify';

import type { CreateServiceInput } from '../domain/service.js';
import type { MetadataStore } from '../metadata/metadata-store.js';
import type { AppMetrics } from '../observability/metrics.js';

interface DependencyBody {
  readonly service: string;
  readonly dependency: string;
}

const serviceNameSchema = {
  type: 'string',
  pattern: '^[a-z][a-z0-9-]{0,62}$',
} as const;

export function registerServiceRoutes(
  app: FastifyInstance,
  metadata: MetadataStore,
  metrics: AppMetrics,
): void {
  app.post<{ Body: CreateServiceInput }>(
    '/services',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: {
            name: serviceNameSchema,
            deploymentDurationMs: {
              type: 'integer',
              minimum: 1,
              maximum: 60_000,
            },
            failureMode: { type: 'string', enum: ['never', 'always'] },
          },
        },
      },
    },
    (request, reply) => {
      const startedAt = process.hrtime.bigint();
      let service;
      try {
        service = metadata.addService(request.body);
      } finally {
        metrics.observeGraphBuild(elapsedSeconds(startedAt));
      }
      metrics.setGraphSize(metadata.snapshot().graph.size);
      return reply.status(201).send(service);
    },
  );

  app.post<{ Body: DependencyBody }>(
    '/dependencies',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['service', 'dependency'],
          properties: {
            service: serviceNameSchema,
            dependency: serviceNameSchema,
          },
        },
      },
    },
    (request, reply) => {
      const startedAt = process.hrtime.bigint();
      let edge;
      try {
        edge = metadata.addDependency(
          request.body.service,
          request.body.dependency,
        );
      } finally {
        metrics.observeGraphBuild(elapsedSeconds(startedAt));
      }
      metrics.setGraphSize(metadata.snapshot().graph.size);
      return reply.status(201).send(edge);
    },
  );
}

function elapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}
