import type {
  ServiceDefinition,
  ServiceDeploymentResult,
} from '../domain/service.js';
import type { DeploymentExecutor } from './deployment-scheduler.js';

export class DeploymentWorker implements DeploymentExecutor {
  public async deploy(
    service: ServiceDefinition,
    signal: AbortSignal,
  ): Promise<ServiceDeploymentResult> {
    const startedAt = new Date();
    await wait(service.deploymentDurationMs, signal);
    const finishedAt = new Date();
    if (service.failureMode === 'always') {
      return {
        service: service.name,
        status: 'failed',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: 'Configured deployment failure',
      };
    }
    return {
      service: service.name,
      status: 'succeeded',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }
}

function wait(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(resolve, durationMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Deployment aborted');
}
