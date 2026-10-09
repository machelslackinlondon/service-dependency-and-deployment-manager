import type {
  ServiceDefinition,
  ServiceDeploymentResult,
} from '../domain/service.js';
import type { DeploymentExecutor } from './deployment-scheduler.js';

export class DeploymentWorker implements DeploymentExecutor {
  public constructor(private readonly timeoutMs: number) {}

  public async deploy(
    service: ServiceDefinition,
    signal: AbortSignal,
  ): Promise<ServiceDeploymentResult> {
    const startedAt = new Date();
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => {
      controller.abort(abortError(signal));
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new Error(`Deployment timed out after ${this.timeoutMs}ms`),
      );
    }, this.timeoutMs);

    try {
      await wait(service.deploymentDurationMs, controller.signal);
    } catch (error) {
      const finishedAt = new Date();
      return {
        service: service.name,
        status: timedOut ? 'timed_out' : 'failed',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: errorMessage(error),
      };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Deployment failed';
}
