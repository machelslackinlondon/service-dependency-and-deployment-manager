import type { DependencyEdge } from '../src/graph/dependency-graph.js';

export interface GraphFixture {
  readonly services: readonly string[];
  readonly edges: readonly DependencyEdge[];
}

export function chainGraph(serviceCount: number): GraphFixture {
  assertPositiveInteger(serviceCount, 'Service count');
  const services = serviceNames(serviceCount);
  const edges = services.slice(1).map((service, index) => ({
    service,
    dependency: services[index] as string,
  }));
  return { services, edges };
}

export function layeredDag(
  serviceCount: number,
  layerCount: number,
  maxFanIn: number,
): GraphFixture {
  assertPositiveInteger(serviceCount, 'Service count');
  if (!Number.isSafeInteger(layerCount) || layerCount < 2) {
    throw new Error('Layer count must be at least 2');
  }
  assertPositiveInteger(maxFanIn, 'Maximum fan-in');
  if (layerCount > serviceCount) {
    throw new Error('Layer count cannot exceed service count');
  }

  const services = serviceNames(serviceCount);
  const layers = Array.from({ length: layerCount }, () => [] as string[]);
  services.forEach((service, index) => {
    const layer = Math.min(
      layerCount - 1,
      Math.floor((index * layerCount) / serviceCount),
    );
    layers[layer]?.push(service);
  });

  const edgeKeys = new Set<string>();
  const edges: DependencyEdge[] = [];
  for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
    const current = layers[layerIndex] ?? [];
    const previous = layers[layerIndex - 1] ?? [];
    current.forEach((service, serviceIndex) => {
      const dependencyCount = Math.min(maxFanIn, previous.length);
      for (let offset = 0; offset < dependencyCount; offset += 1) {
        const dependency =
          previous[(serviceIndex + offset) % previous.length];
        if (dependency === undefined) {
          continue;
        }
        const key = `${service}\u0000${dependency}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({ service, dependency });
        }
      }
    });
  }
  return { services, edges };
}

function serviceNames(count: number): readonly string[] {
  const width = Math.max(4, String(count - 1).length);
  return Array.from(
    { length: count },
    (_, index) => `service-${String(index).padStart(width, '0')}`,
  );
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be positive`);
  }
}
