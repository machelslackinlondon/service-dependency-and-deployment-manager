import {
  DependencyGraph,
  type DependencyEdge,
} from '../../src/graph/dependency-graph.js';

const limits = { maxServices: 100, maxEdges: 100 };

function expectDependencyFirst(
  order: readonly string[],
  edges: readonly DependencyEdge[],
): void {
  const indexes = new Map(order.map((service, index) => [service, index]));
  for (const edge of edges) {
    expect(indexes.get(edge.dependency)).toBeLessThan(
      indexes.get(edge.service) as number,
    );
  }
}

describe("Kahn's topological sort", () => {
  test('orders every dependency before its service', () => {
    const edges = [
      { service: 'api', dependency: 'auth' },
      { service: 'auth', dependency: 'database' },
      { service: 'worker', dependency: 'queue' },
    ];
    const graph = DependencyGraph.from(
      ['worker', 'queue', 'api', 'auth', 'database'],
      edges,
      limits,
    );

    const order = graph.topologicalSortKahn();

    expect(order).toEqual(['database', 'queue', 'auth', 'worker', 'api']);
    expectDependencyFirst(order, edges);
  });

  test('handles empty, single, and independent services', () => {
    expect(DependencyGraph.from([], [], limits).topologicalSortKahn()).toEqual(
      [],
    );
    expect(
      DependencyGraph.from(['api'], [], limits).topologicalSortKahn(),
    ).toEqual(['api']);
    expect(
      DependencyGraph.from(['worker', 'api'], [], limits).topologicalSortKahn(),
    ).toEqual(['api', 'worker']);
  });

  test('sorts a dependency-closed subset', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth', 'database', 'worker'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'database' },
      ],
      limits,
    );

    expect(
      graph.topologicalSortKahn(new Set(['api', 'auth', 'database'])),
    ).toEqual(['database', 'auth', 'api']);
  });

  test('rejects a residual cycle', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'api' },
      ],
      limits,
    );

    expect(() => graph.topologicalSortKahn()).toThrow(
      'Dependency cycle detected: api -> auth -> api',
    );
  });

  test('both algorithms produce valid orders for a branching DAG', () => {
    const edges = [
      { service: 'api', dependency: 'auth' },
      { service: 'api', dependency: 'cache' },
      { service: 'auth', dependency: 'database' },
      { service: 'worker', dependency: 'database' },
    ];
    const graph = DependencyGraph.from(
      ['api', 'auth', 'cache', 'database', 'worker'],
      edges,
      limits,
    );

    const dfs = graph.topologicalSortDfs();
    const kahn = graph.topologicalSortKahn();

    expect(new Set(dfs)).toEqual(new Set(graph.services()));
    expect(new Set(kahn)).toEqual(new Set(graph.services()));
    expectDependencyFirst(dfs, edges);
    expectDependencyFirst(kahn, edges);
  });
});
