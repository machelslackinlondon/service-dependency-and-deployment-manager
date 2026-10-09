import { DependencyGraph } from '../../src/graph/dependency-graph.js';

const limits = { maxServices: 10, maxEdges: 10 };

describe('DependencyGraph construction', () => {
  test('constructs an empty graph', () => {
    const graph = DependencyGraph.from([], [], limits);

    expect(graph.services()).toEqual([]);
    expect(graph.size).toBe(0);
    expect(graph.edgeCount).toBe(0);
  });

  test('constructs sorted forward and reverse adjacency lists', () => {
    const graph = DependencyGraph.from(
      ['worker', 'api', 'database', 'auth'],
      [
        { service: 'api', dependency: 'database' },
        { service: 'api', dependency: 'auth' },
        { service: 'auth', dependency: 'database' },
      ],
      limits,
    );

    expect(graph.services()).toEqual(['api', 'auth', 'database', 'worker']);
    expect(graph.dependenciesOf('api')).toEqual(['auth', 'database']);
    expect(graph.dependentsOf('database')).toEqual(['api', 'auth']);
    expect(graph.edgeCount).toBe(3);
  });

  test('rejects an edge with an unregistered endpoint', () => {
    expect(() =>
      DependencyGraph.from(
        ['api'],
        [{ service: 'api', dependency: 'database' }],
        limits,
      ),
    ).toThrow('Unknown dependency: database');
  });

  test('rejects a duplicate edge', () => {
    expect(() =>
      DependencyGraph.from(
        ['api', 'auth'],
        [
          { service: 'api', dependency: 'auth' },
          { service: 'api', dependency: 'auth' },
        ],
        limits,
      ),
    ).toThrow('Dependency already exists: api -> auth');
  });

  test('rejects service and edge limit violations', () => {
    expect(() =>
      DependencyGraph.from(['a', 'b'], [], { maxServices: 1, maxEdges: 10 }),
    ).toThrow('Service graph limit exceeded');

    expect(() =>
      DependencyGraph.from(
        ['a', 'b'],
        [{ service: 'a', dependency: 'b' }],
        { maxServices: 10, maxEdges: 0 },
      ),
    ).toThrow('Dependency edge limit exceeded');
  });
});

describe('DependencyGraph traversal', () => {
  const graph = DependencyGraph.from(
    ['api', 'auth', 'database', 'worker'],
    [
      { service: 'api', dependency: 'auth' },
      { service: 'auth', dependency: 'database' },
    ],
    limits,
  );

  test('visits dependencies breadth-first without unrelated services', () => {
    expect(graph.bfs('api')).toEqual(['api', 'auth', 'database']);
  });

  test('returns a dependency-closed target set', () => {
    expect([...graph.dependencyClosure(['api', 'worker'])].sort()).toEqual([
      'api',
      'auth',
      'database',
      'worker',
    ]);
  });

  test('rejects traversal from an unknown service', () => {
    expect(() => graph.bfs('missing')).toThrow('Unknown service: missing');
  });
});
