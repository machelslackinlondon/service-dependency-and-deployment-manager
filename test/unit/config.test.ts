import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  test('parses numeric environment settings', () => {
    const config = loadConfig({
      PORT: '9000',
      MAX_ACTIVE_DEPLOYMENTS: '3',
    });

    expect(config.port).toBe(9000);
    expect(config.maxActiveDeployments).toBe(3);
  });

  test.each(['0', '-1', 'not-a-number'])(
    'rejects invalid concurrency limit %s',
    (value) => {
      expect(() => loadConfig({ MAX_ACTIVE_DEPLOYMENTS: value })).toThrow(
        'MAX_ACTIVE_DEPLOYMENTS must be a positive integer',
      );
    },
  );
});
