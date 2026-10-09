export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly maxServices: number;
  readonly maxEdges: number;
  readonly maxQueuedDeployments: number;
  readonly maxActiveJobs: number;
  readonly maxActiveDeployments: number;
  readonly maxDeploymentsPerJob: number;
  readonly deploymentTimeoutMs: number;
  readonly metadataMaxAgeMs: number;
  readonly healthCheckConcurrency: number;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly jobRetention: number;
  readonly shutdownGraceMs: number;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return Object.freeze({
    host: env.HOST ?? '0.0.0.0',
    port: positiveInteger(env, 'PORT', 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    maxServices: positiveInteger(env, 'MAX_SERVICES', 10_000),
    maxEdges: positiveInteger(env, 'MAX_EDGES', 50_000),
    maxQueuedDeployments: positiveInteger(
      env,
      'MAX_QUEUED_DEPLOYMENTS',
      100,
    ),
    maxActiveJobs: positiveInteger(env, 'MAX_ACTIVE_JOBS', 4),
    maxActiveDeployments: positiveInteger(
      env,
      'MAX_ACTIVE_DEPLOYMENTS',
      8,
    ),
    maxDeploymentsPerJob: positiveInteger(
      env,
      'MAX_DEPLOYMENTS_PER_JOB',
      4,
    ),
    deploymentTimeoutMs: positiveInteger(
      env,
      'DEPLOYMENT_TIMEOUT_MS',
      5_000,
    ),
    metadataMaxAgeMs: positiveInteger(env, 'METADATA_MAX_AGE_MS', 300_000),
    healthCheckConcurrency: positiveInteger(
      env,
      'HEALTH_CHECK_CONCURRENCY',
      4,
    ),
    rateLimitMax: positiveInteger(env, 'RATE_LIMIT_MAX', 100),
    rateLimitWindowMs: positiveInteger(env, 'RATE_LIMIT_WINDOW_MS', 60_000),
    jobRetention: positiveInteger(env, 'JOB_RETENTION', 1_000),
    shutdownGraceMs: positiveInteger(env, 'SHUTDOWN_GRACE_MS', 10_000),
  });
}
