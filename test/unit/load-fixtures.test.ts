import { DependencyGraph } from '../../src/graph/dependency-graph.js';
import { chainGraph, layeredDag } from '../../load/fixtures.js';

describe('load graph fixtures', () => {
  test('generates an exact acyclic chain', () => {
    const fixture = chainGraph(100);
    const graph = DependencyGraph.from(
      fixture.services,
      fixture.edges,
      { maxServices: 100, maxEdges: 99 },
    );

    expect(fixture.services).toHaveLength(100);
    expect(fixture.edges).toHaveLength(99);
    expect(graph.findCycle()).toBeNull();
    expect(graph.topologicalSortKahn()).toHaveLength(100);
  });

  test('generates a deterministic layered DAG with bounded fan-in', () => {
    const first = layeredDag(100, 10, 3);
    const second = layeredDag(100, 10, 3);
    const graph = DependencyGraph.from(first.services, first.edges, {
      maxServices: 100,
      maxEdges: 300,
    });

    expect(first).toEqual(second);
    expect(first.services).toHaveLength(100);
    expect(first.edges.length).toBeLessThanOrEqual(270);
    expect(graph.findCycle()).toBeNull();
  });

  test('rejects invalid fixture dimensions', () => {
    expect(() => chainGraph(0)).toThrow('Service count must be positive');
    expect(() => layeredDag(10, 1, 2)).toThrow(
      'Layer count must be at least 2',
    );
  });
});
