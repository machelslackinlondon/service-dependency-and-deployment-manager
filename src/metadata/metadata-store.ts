import {
  createServiceDefinition,
  type CreateServiceInput,
  type ServiceDefinition,
} from '../domain/service.js';
import {
  ConflictError,
  MetadataStaleError,
  MetadataUnavailableError,
} from '../errors.js';
import {
  DependencyGraph,
  type DependencyEdge,
  type GraphLimits,
} from '../graph/dependency-graph.js';
import type { DeploymentSnapshot } from '../scheduler/deployment-scheduler.js';

export interface MetadataStoreOptions {
  readonly limits: GraphLimits;
  readonly maxAgeMs: number;
  readonly now?: () => number;
}

export interface MetadataReadiness {
  readonly available: boolean;
  readonly fresh: boolean;
  readonly ready: boolean;
  readonly ageMs: number;
  readonly version: number;
}

export class MetadataStore {
  readonly #limits: GraphLimits;
  readonly #maxAgeMs: number;
  readonly #now: () => number;
  #services = new Map<string, ServiceDefinition>();
  #edges: DependencyEdge[] = [];
  #graph: DependencyGraph;
  #version = 0;
  #available = true;
  #updatedAt: number;

  public constructor(options: MetadataStoreOptions) {
    this.#limits = options.limits;
    this.#maxAgeMs = options.maxAgeMs;
    this.#now = options.now ?? Date.now;
    this.#updatedAt = this.#now();
    this.#graph = DependencyGraph.from([], [], this.#limits);
  }

  public addService(input: CreateServiceInput): ServiceDefinition {
    this.#assertAvailable();
    const definition = createServiceDefinition(input);
    if (this.#services.has(definition.name)) {
      throw new ConflictError(`Service already exists: ${definition.name}`);
    }

    const candidateServices = new Map(this.#services);
    candidateServices.set(definition.name, definition);
    const candidateGraph = DependencyGraph.from(
      candidateServices.keys(),
      this.#edges,
      this.#limits,
    );
    this.#services = candidateServices;
    this.#graph = candidateGraph;
    this.#commitMutation();
    return definition;
  }

  public addDependency(service: string, dependency: string): DependencyEdge {
    this.#assertAvailable();
    const edge = Object.freeze({ service, dependency });
    const candidateEdges = [...this.#edges, edge];
    const candidateGraph = DependencyGraph.from(
      this.#services.keys(),
      candidateEdges,
      this.#limits,
    );
    candidateGraph.assertAcyclic();
    this.#edges = candidateEdges;
    this.#graph = candidateGraph;
    this.#commitMutation();
    return edge;
  }

  public snapshot(now = this.#now()): DeploymentSnapshot {
    this.#assertReadable(now);
    return Object.freeze({
      version: this.#version,
      capturedAt: new Date(now).toISOString(),
      services: new Map(this.#services),
      graph: this.#graph,
    });
  }

  public readiness(now = this.#now()): MetadataReadiness {
    const ageMs = Math.max(0, now - this.#updatedAt);
    const fresh = ageMs <= this.#maxAgeMs;
    return Object.freeze({
      available: this.#available,
      fresh,
      ready: this.#available && fresh,
      ageMs,
      version: this.#version,
    });
  }

  public setAvailability(available: boolean): void {
    this.#available = available;
  }

  public refresh(): boolean {
    if (!this.#available) {
      return false;
    }
    this.#updatedAt = this.#now();
    return true;
  }

  #commitMutation(): void {
    this.#version += 1;
    this.#updatedAt = this.#now();
  }

  #assertAvailable(): void {
    if (!this.#available) {
      throw new MetadataUnavailableError();
    }
  }

  #assertReadable(now: number): void {
    this.#assertAvailable();
    if (now - this.#updatedAt > this.#maxAgeMs) {
      throw new MetadataStaleError();
    }
  }
}
