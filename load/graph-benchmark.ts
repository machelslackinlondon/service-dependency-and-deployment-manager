import { performance } from 'node:perf_hooks';

import { DependencyGraph } from '../src/graph/dependency-graph.js';
import { layeredDag } from './fixtures.js';

interface Measurement {
  readonly services: number;
  readonly edges: number;
  readonly graphBuildMs: number;
  readonly dfsTopologicalSortMs: number;
  readonly kahnTopologicalSortMs: number;
  readonly bfsMs: number;
  readonly heapDeltaBytes: number;
  readonly userCpuMicros: number;
  readonly systemCpuMicros: number;
}

const sizes = parseSizes(process.argv.slice(2));
const measurements = sizes.map(measure);
process.stdout.write(`${JSON.stringify({ measurements }, null, 2)}\n`);

function measure(serviceCount: number): Measurement {
  const fixture = layeredDag(
    serviceCount,
    Math.max(2, Math.floor(Math.sqrt(serviceCount))),
    3,
  );
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();

  const buildStart = performance.now();
  const graph = DependencyGraph.from(fixture.services, fixture.edges, {
    maxServices: serviceCount,
    maxEdges: fixture.edges.length,
  });
  const graphBuildMs = performance.now() - buildStart;

  const dfsStart = performance.now();
  const dfs = graph.topologicalSortDfs();
  const dfsTopologicalSortMs = performance.now() - dfsStart;

  const kahnStart = performance.now();
  const kahn = graph.topologicalSortKahn();
  const kahnTopologicalSortMs = performance.now() - kahnStart;

  const bfsStart = performance.now();
  graph.bfs(fixture.services.at(-1) as string);
  const bfsMs = performance.now() - bfsStart;

  validateOrder(dfs, fixture.edges);
  validateOrder(kahn, fixture.edges);
  const cpu = process.cpuUsage(cpuBefore);
  return {
    services: serviceCount,
    edges: fixture.edges.length,
    graphBuildMs,
    dfsTopologicalSortMs,
    kahnTopologicalSortMs,
    bfsMs,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    userCpuMicros: cpu.user,
    systemCpuMicros: cpu.system,
  };
}

function validateOrder(
  order: readonly string[],
  edges: readonly { service: string; dependency: string }[],
): void {
  const indexes = new Map(order.map((service, index) => [service, index]));
  if (indexes.size !== order.length) {
    throw new Error('Topological order contains duplicate services');
  }
  for (const edge of edges) {
    const serviceIndex = indexes.get(edge.service);
    const dependencyIndex = indexes.get(edge.dependency);
    if (
      serviceIndex === undefined ||
      dependencyIndex === undefined ||
      dependencyIndex >= serviceIndex
    ) {
      throw new Error(
        `Invalid topological order for ${edge.service} -> ${edge.dependency}`,
      );
    }
  }
}

function parseSizes(args: readonly string[]): readonly number[] {
  const raw = args.find((argument) => argument.startsWith('--sizes='));
  const values = (raw?.slice('--sizes='.length) ?? '100,1000')
    .split(',')
    .map(Number);
  if (
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new Error('Sizes must be a comma-separated list of positive integers');
  }
  return values;
}
