import { DependencyGraph } from '../../src/graph/dependency-graph.js';

const limits = { maxServices: 20_000, maxEdges: 20_000 };

describe('DFS topological sort', () => {
  test('orders dependencies before their services', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth', 'database'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'database' },
      ],
      limits,
    );

    expect(graph.topologicalSortDfs()).toEqual(['database', 'auth', 'api']);
  });

  test('handles empty, single, and independent services deterministically', () => {
    expect(DependencyGraph.from([], [], limits).topologicalSortDfs()).toEqual(
      [],
    );
    expect(
      DependencyGraph.from(['api'], [], limits).topologicalSortDfs(),
    ).toEqual(['api']);
    expect(
      DependencyGraph.from(['worker', 'api'], [], limits).topologicalSortDfs(),
    ).toEqual(['api', 'worker']);
  });

  test('sorts only a dependency-closed subset', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth', 'database', 'worker'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'database' },
      ],
      limits,
    );

    expect(
      graph.topologicalSortDfs(new Set(['api', 'auth', 'database'])),
    ).toEqual(['database', 'auth', 'api']);
  });

  test('rejects a subset that omits a required dependency', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth'],
      [{ service: 'api', dependency: 'auth' }],
      limits,
    );

    expect(() => graph.topologicalSortDfs(new Set(['api']))).toThrow(
      'Topological subset must include dependency auth for api',
    );
  });

  test('rejects a cyclic graph', () => {
    const graph = DependencyGraph.from(
      ['api', 'auth'],
      [
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'api' },
      ],
      limits,
    );

    expect(() => graph.topologicalSortDfs()).toThrow(
      'Dependency cycle detected',
    );
  });
});
