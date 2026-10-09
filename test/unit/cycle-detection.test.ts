import { DependencyGraph } from '../../src/graph/dependency-graph.js';

const limits = { maxServices: 20_000, maxEdges: 20_000 };

describe('DFS cycle detection', () => {
  test('returns null for an acyclic graph', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth', 'database'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'database' },
      ],
      limits,
    );

    expect(graph.findCycle()).toBeNull();
    expect(() => graph.assertAcyclic()).not.toThrow();
  });

  test('returns a deterministic closed cycle path', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'api' },
      ],
      limits,
    );

    expect(graph.findCycle()).toEqual(['api', 'auth', 'api']);
    expect(() => graph.assertAcyclic()).toThrow(
      'Dependency cycle detected: api -> auth -> api',
    );
  });

  test('finds a cycle in a disconnected component', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth', 'worker', 'queue'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'queue', dependency: 'worker' },
        { service: 'worker', dependency: 'queue' },
      ],
      limits,
    );

    expect(graph.findCycle()).toEqual(['queue', 'worker', 'queue']);
  });

  test('handles a 10,000-service chain without overflowing the call stack', () => {
    const services = Array.from({ length: 10_000 }, (_, index) => `s${index}`);
    const edges = services.slice(1).map((service, index) => ({
      service,
      dependency: services[index] as string,
    }));
    const graph = DependencyGraph.from(services, edges, limits);

    expect(graph.findCycle()).toBeNull();
  });
});
