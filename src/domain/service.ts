import { ValidationError } from '../errors.js';

export type FailureMode = 'never' | 'always';

export interface CreateServiceInput {
  readonly name: string;
  readonly deploymentDurationMs?: number;
  readonly failureMode?: FailureMode;
}

export interface ServiceDefinition {
  readonly name: string;
  readonly deploymentDurationMs: number;
  readonly failureMode: FailureMode;
}

export type DeploymentJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'timed_out';

export type ServiceDeploymentStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'blocked';

export interface ServiceDeploymentResult {
  readonly service: string;
  readonly status: ServiceDeploymentStatus;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly error?: string;
  readonly blockedBy?: string;
}

export interface DeploymentJob {
  readonly id: string;
  readonly status: DeploymentJobStatus;
  readonly metadataVersion: number;
  readonly requestedTargets: readonly string[];
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly results: ReadonlyMap<string, ServiceDeploymentResult>;
}

const SERVICE_NAME = /^[a-z][a-z0-9-]{0,62}$/;

export function createServiceDefinition(
  input: CreateServiceInput,
): ServiceDefinition {
  const name = input.name.trim();
  if (!SERVICE_NAME.test(name)) {
    throw new ValidationError(
      'Service name must match ^[a-z][a-z0-9-]{0,62}$',
    );
  }

  const deploymentDurationMs = input.deploymentDurationMs ?? 50;
  if (
    !Number.isInteger(deploymentDurationMs) ||
    deploymentDurationMs < 1 ||
    deploymentDurationMs > 60_000
  ) {
    throw new ValidationError(
      'Deployment duration must be an integer between 1 and 60000',
    );
  }

  const failureMode = input.failureMode ?? 'never';
  if (failureMode !== 'never' && failureMode !== 'always') {
    throw new ValidationError('Failure mode must be never or always');
  }

  return Object.freeze({ name, deploymentDurationMs, failureMode });
}
