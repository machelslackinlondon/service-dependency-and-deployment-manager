import type { FastifyInstance } from 'fastify';

import type { DeploymentJob } from '../domain/service.js';
import type { MetadataStore } from '../metadata/metadata-store.js';
import type { DeploymentScheduler } from '../scheduler/deployment-scheduler.js';
import type { JobStore } from '../scheduler/job-store.js';

interface OrderQuery {
  readonly algorithm?: 'kahn' | 'dfs';
}

interface DeployBody {
  readonly targets?: readonly string[];
}

interface JobParams {
  readonly id: string;
}

export function registerDeploymentRoutes(
  app: FastifyInstance,
  metadata: MetadataStore,
  scheduler: DeploymentScheduler,
  jobs: JobStore,
): void {
  app.get<{ Querystring: OrderQuery }>(
    '/deployment-order',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            algorithm: { type: 'string', enum: ['kahn', 'dfs'] },
          },
        },
      },
    },
    (request) => {
      const snapshot = metadata.snapshot();
      const algorithm = request.query.algorithm ?? 'kahn';
      const order =
        algorithm === 'dfs'
          ? snapshot.graph.topologicalSortDfs()
          : snapshot.graph.topologicalSortKahn();
      return { algorithm, order, metadataVersion: snapshot.version };
    },
  );

  app.post<{ Body: DeployBody }>(
    '/deploy',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            targets: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,62}$' },
            },
          },
        },
      },
    },
    (request, reply) => {
      const snapshot = metadata.snapshot();
      const job = scheduler.submit(snapshot, request.body.targets);
      return reply
        .status(202)
        .header('location', `/deployments/${job.id}`)
        .send(serializeJob(job));
    },
  );

  app.get<{ Params: JobParams }>(
    '/deployments/:id',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1 } },
        },
      },
    },
    (request) => serializeJob(jobs.get(request.params.id)),
  );
}

function serializeJob(job: DeploymentJob): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    metadataVersion: job.metadataVersion,
    requestedTargets: job.requestedTargets,
    createdAt: job.createdAt,
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    results: Object.fromEntries(job.results),
  };
}
