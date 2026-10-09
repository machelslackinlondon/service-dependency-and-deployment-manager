import {
  CapacityError,
  ConflictError,
  CycleError,
  NotFoundError,
  ValidationError,
} from '../errors.js';

export interface DependencyEdge {
  readonly service: string;
  readonly dependency: string;
}

export interface GraphLimits {
  readonly maxServices: number;
  readonly maxEdges: number;
}

export class DependencyGraph {
  readonly #dependencies: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #dependents: ReadonlyMap<string, ReadonlySet<string>>;
  public readonly edgeCount: number;

  private constructor(
    dependencies: ReadonlyMap<string, ReadonlySet<string>>,
    dependents: ReadonlyMap<string, ReadonlySet<string>>,
    edgeCount: number,
  ) {
    this.#dependencies = dependencies;
    this.#dependents = dependents;
    this.edgeCount = edgeCount;
  }

  public static from(
    services: Iterable<string>,
    edges: Iterable<DependencyEdge>,
    limits: GraphLimits,
  ): DependencyGraph {
    const dependencies = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();

    for (const service of services) {
      if (dependencies.has(service)) {
        throw new ConflictError(`Service already exists: ${service}`);
      }
      dependencies.set(service, new Set());
      dependents.set(service, new Set());
      if (dependencies.size > limits.maxServices) {
        throw new CapacityError(
          `Service graph limit exceeded: maximum ${limits.maxServices}`,
        );
      }
    }

    let edgeCount = 0;
    for (const edge of edges) {
      const serviceDependencies = dependencies.get(edge.service);
      if (serviceDependencies === undefined) {
        throw new NotFoundError(`Unknown service: ${edge.service}`);
      }
      const dependencyDependents = dependents.get(edge.dependency);
      if (dependencyDependents === undefined) {
        throw new NotFoundError(`Unknown dependency: ${edge.dependency}`);
      }
      if (serviceDependencies.has(edge.dependency)) {
        throw new ConflictError(
          `Dependency already exists: ${edge.service} -> ${edge.dependency}`,
        );
      }
      edgeCount += 1;
      if (edgeCount > limits.maxEdges) {
        throw new CapacityError(
          `Dependency edge limit exceeded: maximum ${limits.maxEdges}`,
        );
      }
      serviceDependencies.add(edge.dependency);
      dependencyDependents.add(edge.service);
    }

    return new DependencyGraph(dependencies, dependents, edgeCount);
  }

  public get size(): number {
    return this.#dependencies.size;
  }

  public services(): readonly string[] {
    return [...this.#dependencies.keys()].sort();
  }

  public dependenciesOf(service: string): readonly string[] {
    return [...this.#lookup(this.#dependencies, service)].sort();
  }

  public dependentsOf(service: string): readonly string[] {
    return [...this.#lookup(this.#dependents, service)].sort();
  }

  public bfs(start: string): readonly string[] {
    this.#lookup(this.#dependencies, start);
    const visited = new Set([start]);
    const queue = [start];
    const result: string[] = [];

    for (let head = 0; head < queue.length; head += 1) {
      const service = queue[head];
      if (service === undefined) {
        continue;
      }
      result.push(service);
      for (const dependency of this.dependenciesOf(service)) {
        if (!visited.has(dependency)) {
          visited.add(dependency);
          queue.push(dependency);
        }
      }
    }
    return result;
  }

  public dependencyClosure(targets: Iterable<string>): ReadonlySet<string> {
    const visited = new Set<string>();
    const queue: string[] = [];

    for (const target of targets) {
      this.#lookup(this.#dependencies, target);
      if (!visited.has(target)) {
        visited.add(target);
        queue.push(target);
      }
    }

    for (let head = 0; head < queue.length; head += 1) {
      const service = queue[head];
      if (service === undefined) {
        continue;
      }
      for (const dependency of this.dependenciesOf(service)) {
        if (!visited.has(dependency)) {
          visited.add(dependency);
          queue.push(dependency);
        }
      }
    }

    return visited;
  }

  public findCycle(): readonly string[] | null {
    type Color = 0 | 1 | 2;
    interface Frame {
      readonly service: string;
      readonly dependencies: readonly string[];
      index: number;
    }

    const colors = new Map<string, Color>();
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();

    for (const root of this.services()) {
      if ((colors.get(root) ?? 0) !== 0) {
        continue;
      }

      colors.set(root, 1);
      pathIndexes.set(root, path.length);
      path.push(root);
      const stack: Frame[] = [
        { service: root, dependencies: this.dependenciesOf(root), index: 0 },
      ];

      while (stack.length > 0) {
        const frame = stack.at(-1);
        if (frame === undefined) {
          break;
        }
        const dependency = frame.dependencies[frame.index];
        if (dependency === undefined) {
          colors.set(frame.service, 2);
          pathIndexes.delete(frame.service);
          path.pop();
          stack.pop();
          continue;
        }
        frame.index += 1;

        const color = colors.get(dependency) ?? 0;
        if (color === 1) {
          const cycleStart = pathIndexes.get(dependency);
          if (cycleStart === undefined) {
            throw new Error('Cycle path state is inconsistent');
          }
          return [...path.slice(cycleStart), dependency];
        }
        if (color === 0) {
          colors.set(dependency, 1);
          pathIndexes.set(dependency, path.length);
          path.push(dependency);
          stack.push({
            service: dependency,
            dependencies: this.dependenciesOf(dependency),
            index: 0,
          });
        }
      }
    }

    return null;
  }

  public assertAcyclic(): void {
    const cycle = this.findCycle();
    if (cycle !== null) {
      throw new CycleError(cycle);
    }
  }

  public topologicalSortDfs(
    subset?: ReadonlySet<string>,
  ): readonly string[] {
    type Color = 0 | 1 | 2;
    interface Frame {
      readonly service: string;
      readonly dependencies: readonly string[];
      index: number;
    }

    const selected = subset ?? new Set(this.services());
    for (const service of selected) {
      this.#lookup(this.#dependencies, service);
      for (const dependency of this.dependenciesOf(service)) {
        if (!selected.has(dependency)) {
          throw new ValidationError(
            `Topological subset must include dependency ${dependency} for ${service}`,
          );
        }
      }
    }

    const colors = new Map<string, Color>();
    const result: string[] = [];
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();

    for (const root of [...selected].sort()) {
      if ((colors.get(root) ?? 0) !== 0) {
        continue;
      }
      colors.set(root, 1);
      pathIndexes.set(root, path.length);
      path.push(root);
      const stack: Frame[] = [
        { service: root, dependencies: this.dependenciesOf(root), index: 0 },
      ];

      while (stack.length > 0) {
        const frame = stack.at(-1);
        if (frame === undefined) {
          break;
        }
        const dependency = frame.dependencies[frame.index];
        if (dependency === undefined) {
          colors.set(frame.service, 2);
          result.push(frame.service);
          pathIndexes.delete(frame.service);
          path.pop();
          stack.pop();
          continue;
        }
        frame.index += 1;

        const color = colors.get(dependency) ?? 0;
        if (color === 1) {
          const cycleStart = pathIndexes.get(dependency);
          if (cycleStart === undefined) {
            throw new Error('Cycle path state is inconsistent');
          }
          throw new CycleError([...path.slice(cycleStart), dependency]);
        }
        if (color === 0) {
          colors.set(dependency, 1);
          pathIndexes.set(dependency, path.length);
          path.push(dependency);
          stack.push({
            service: dependency,
            dependencies: this.dependenciesOf(dependency),
            index: 0,
          });
        }
      }
    }

    return result;
  }

  #lookup(
    map: ReadonlyMap<string, ReadonlySet<string>>,
    service: string,
  ): ReadonlySet<string> {
    const values = map.get(service);
    if (values === undefined) {
      throw new NotFoundError(`Unknown service: ${service}`);
    }
    return values;
  }
}
