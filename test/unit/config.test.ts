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

  test('rejects an out-of-range TCP port', () => {
    expect(() => loadConfig({ PORT: '65536' })).toThrow(
      'PORT must be between 1 and 65535',
    );
  });

  test('validates the runtime environment', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).nodeEnv).toBe('production');
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(
      'NODE_ENV must be development, test, or production',
    );
  });
});
