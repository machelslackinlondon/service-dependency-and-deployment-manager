import { AppMetrics } from '../../src/observability/metrics.js';

describe('AppMetrics', () => {
  test('exports all required deployment and graph instruments', async () => {
    const metrics = new AppMetrics();

    metrics.recordDeploymentRequest();
    metrics.setActiveDeployments(2);
    metrics.setGraphSize(7);
    metrics.setQueueDepth(3);
    metrics.recordCycleFailure();
    metrics.recordJobCompletion('failed', 0.25);
    metrics.observeGraphBuild(0.01);
    metrics.observeTopologicalSort(0.02);

    const output = await metrics.registry.metrics();
    expect(output).toContain('deployment_requests_total 1');
    expect(output).toContain('active_deployments 2');
    expect(output).toContain('failed_deployments_total 1');
    expect(output).toContain('dependency_graph_size 7');
    expect(output).toContain('deployment_queue_depth 3');
    expect(output).toContain('cycle_detection_failures_total 1');
    expect(output).toContain('deployment_latency_seconds_count 1');
    expect(output).toContain('graph_build_latency_seconds_count 1');
    expect(output).toContain('topological_sort_latency_seconds_count 1');
  });

  test('uses an isolated registry for each application instance', async () => {
    const first = new AppMetrics();
    const second = new AppMetrics();
    first.recordDeploymentRequest();

    expect(await first.registry.metrics()).toContain(
      'deployment_requests_total 1',
    );
    expect(await second.registry.metrics()).toContain(
      'deployment_requests_total 0',
    );
  });
});
