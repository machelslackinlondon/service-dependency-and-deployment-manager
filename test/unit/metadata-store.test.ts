import { MetadataStore } from '../../src/metadata/metadata-store.js';

function createStore(now: () => number): MetadataStore {
  return new MetadataStore({
    limits: { maxServices: 10, maxEdges: 10 },
    maxAgeMs: 1_000,
    now,
  });
}

describe('MetadataStore', () => {
  test('versions successful mutations and returns immutable snapshots', () => {
    let time = 1_000;
    const store = createStore(() => time);

    expect(store.addService({ name: 'api' })).toMatchObject({ name: 'api' });
    time += 10;
    store.addService({ name: 'auth' });
    store.addDependency('api', 'auth');
    const snapshot = store.snapshot();

    expect(snapshot.version).toBe(3);
    expect(snapshot.graph.dependenciesOf('api')).toEqual(['auth']);
    expect(snapshot.services.size).toBe(2);

    store.addService({ name: 'worker' });
    expect(snapshot.services.has('worker')).toBe(false);
    expect(snapshot.graph.services()).toEqual(['api', 'auth']);
  });

  test('rejects duplicate services and missing dependency endpoints', () => {
    const store = createStore(() => 1_000);
    store.addService({ name: 'api' });

    expect(() => store.addService({ name: 'api' })).toThrow(
      'Service already exists: api',
    );
    expect(() => store.addDependency('api', 'database')).toThrow(
      'Unknown dependency: database',
    );
  });

  test('rejects cycles atomically without advancing the version', () => {
    const store = createStore(() => 1_000);
    store.addService({ name: 'api' });
    store.addService({ name: 'auth' });
    store.addDependency('api', 'auth');

    expect(() => store.addDependency('auth', 'api')).toThrow(
      'Dependency cycle detected: api -> auth -> api',
    );
    const snapshot = store.snapshot();
    expect(snapshot.version).toBe(3);
    expect(snapshot.graph.dependenciesOf('auth')).toEqual([]);
  });

  test('fails closed while metadata is unavailable', () => {
    const store = createStore(() => 1_000);
    store.setAvailability(false);

    expect(() => store.snapshot()).toThrow('Dependency metadata is unavailable');
  });

  test('accepts the exact freshness boundary and rejects older metadata', () => {
    let time = 1_000;
    const store = createStore(() => time);
    store.addService({ name: 'api' });

    time = 2_000;
    expect(store.snapshot().version).toBe(1);
    time = 2_001;
    expect(() => store.snapshot()).toThrow('Dependency metadata is stale');
  });

  test('refreshes unchanged available metadata without changing its version', () => {
    let time = 1_000;
    const store = createStore(() => time);
    store.addService({ name: 'api' });

    time = 1_900;
    expect(store.refresh()).toBe(true);
    time = 2_800;
    expect(store.snapshot().version).toBe(1);

    store.setAvailability(false);
    expect(store.refresh()).toBe(false);
  });
});
