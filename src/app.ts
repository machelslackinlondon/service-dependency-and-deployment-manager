import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

import { loadConfig, type AppConfig } from './config.js';
import { OperationalError } from './errors.js';
import { MetadataStore } from './metadata/metadata-store.js';
import { registerDeploymentRoutes } from './routes/deployments.js';
import { registerServiceRoutes } from './routes/services.js';
import { registerSystemRoutes } from './routes/system.js';
import { AsyncSemaphore } from './scheduler/async-semaphore.js';
import { BoundedJobQueue } from './scheduler/bounded-job-queue.js';
import { DeploymentScheduler } from './scheduler/deployment-scheduler.js';
import { DeploymentWorker } from './scheduler/deployment-worker.js';
import { JobStore } from './scheduler/job-store.js';

export interface BuildAppOptions {
  readonly logger?: boolean;
  readonly config?: AppConfig;
  readonly enableTestRoutes?: boolean;
  readonly now?: () => number;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger:
      options.logger === undefined
        ? { level: config.logLevel }
        : options.logger,
  });
  const metadata = new MetadataStore({
    limits: {
      maxServices: config.maxServices,
      maxEdges: config.maxEdges,
    },
    maxAgeMs: config.metadataMaxAgeMs,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const jobs = new JobStore(config.jobRetention);
  const scheduler = new DeploymentScheduler({
    worker: new DeploymentWorker(config.deploymentTimeoutMs),
    jobs,
    maxDeploymentsPerJob: config.maxDeploymentsPerJob,
    maxActiveJobs: config.maxActiveJobs,
    queue: new BoundedJobQueue(config.maxQueuedDeployments),
    globalSemaphore: new AsyncSemaphore(config.maxActiveDeployments),
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof OperationalError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      });
    }
    if (isValidationError(error)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          retryable: false,
        },
      });
    }
    request.log.error({ error }, 'request failed');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        retryable: false,
      },
    });
  });

  registerServiceRoutes(app, metadata);
  registerDeploymentRoutes(app, metadata, scheduler, jobs);
  registerSystemRoutes(app, metadata, options.enableTestRoutes ?? false);
  app.addHook('onClose', async () => scheduler.stop());
  return app;
}

function isValidationError(
  error: unknown,
): error is Error & { readonly validation: unknown } {
  return error instanceof Error && 'validation' in error;
}
