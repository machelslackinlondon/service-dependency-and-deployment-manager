import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

import { loadConfig, type AppConfig } from './config.js';
import { CycleError, OperationalError } from './errors.js';
import { MetadataStore } from './metadata/metadata-store.js';
import { AppMetrics } from './observability/metrics.js';
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
  if (config.nodeEnv === 'production' && options.enableTestRoutes === true) {
    throw new Error('Test routes cannot be enabled in production');
  }
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
  const metrics = new AppMetrics();
  const globalSemaphore = new AsyncSemaphore(config.maxActiveDeployments);
  const scheduler = new DeploymentScheduler({
    worker: new DeploymentWorker(config.deploymentTimeoutMs),
    jobs,
    maxDeploymentsPerJob: config.maxDeploymentsPerJob,
    maxActiveJobs: config.maxActiveJobs,
    queue: new BoundedJobQueue(config.maxQueuedDeployments),
    globalSemaphore,
    observer: {
      stateChanged: (activeDeployments, queueDepth) => {
        metrics.setActiveDeployments(activeDeployments);
        metrics.setQueueDepth(queueDepth);
      },
      jobAccepted: (job) => {
        app.log.info(
          { jobId: job.id, metadataVersion: job.metadataVersion },
          'deployment job accepted',
        );
      },
      jobStarted: (jobId) => {
        app.log.info({ jobId }, 'deployment job started');
      },
      serviceCompleted: (jobId, result) => {
        app.log.info(
          { jobId, service: result.service, outcome: result.status },
          'service deployment completed',
        );
      },
      jobCompleted: (job, durationSeconds) => {
        metrics.recordJobCompletion(job.status, durationSeconds);
        app.log.info(
          { jobId: job.id, outcome: job.status, durationSeconds },
          'deployment job completed',
        );
      },
      schedulerFailed: (jobId, error) => {
        app.log.error({ jobId, error }, 'deployment scheduler failed');
      },
    },
  });
  const metadataHeartbeat = setInterval(
    () => metadata.refresh(),
    Math.max(1, Math.floor(config.metadataMaxAgeMs / 2)),
  );
  metadataHeartbeat.unref();

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof OperationalError) {
      if (error instanceof CycleError) {
        metrics.recordCycleFailure();
      }
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

  registerServiceRoutes(app, metadata, metrics);
  registerDeploymentRoutes(app, metadata, scheduler, jobs, metrics);
  registerSystemRoutes(
    app,
    metadata,
    options.enableTestRoutes ?? false,
    metrics,
    new AsyncSemaphore(config.healthCheckConcurrency),
  );
  app.addHook('onClose', async () => {
    clearInterval(metadataHeartbeat);
    return withTimeout(
      scheduler.stop(),
      config.shutdownGraceMs,
      `Scheduler shutdown exceeded ${config.shutdownGraceMs}ms grace period`,
    );
  });
  return app;
}

function isValidationError(
  error: unknown,
): error is Error & { readonly validation: unknown } {
  return error instanceof Error && 'validation' in error;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
