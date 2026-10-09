import {
  createServiceDefinition,
  type CreateServiceInput,
} from '../../src/domain/service.js';
import {
  CapacityError,
  ConflictError,
  CycleError,
  MetadataStaleError,
  MetadataUnavailableError,
  NotFoundError,
  ValidationError,
} from '../../src/errors.js';

describe('createServiceDefinition', () => {
  test('normalizes whitespace and supplies safe simulation defaults', () => {
    const service = createServiceDefinition({ name: ' api ' });

    expect(service).toEqual({
      name: 'api',
      deploymentDurationMs: 50,
      failureMode: 'never',
    });
    expect(Object.isFrozen(service)).toBe(true);
  });

  test.each(['API', '1-api', 'api_service', '', 'a'.repeat(64)])(
    'rejects unsafe service name %j',
    (name) => {
      expect(() => createServiceDefinition({ name })).toThrow(
        'Service name must match',
      );
    },
  );

  test.each([0, 60_001, 1.5])('rejects invalid duration %s', (duration) => {
    expect(() =>
      createServiceDefinition({ name: 'api', deploymentDurationMs: duration }),
    ).toThrow('Deployment duration must be an integer between 1 and 60000');
  });

  test('rejects an unknown failure mode at the runtime boundary', () => {
    const input = { name: 'api', failureMode: 'sometimes' } as unknown as CreateServiceInput;

    expect(() => createServiceDefinition(input)).toThrow(
      'Failure mode must be never or always',
    );
  });
});

describe('operational errors', () => {
  test.each([
    [new ValidationError('invalid'), 'VALIDATION_ERROR', 400, false],
    [new NotFoundError('missing'), 'NOT_FOUND', 404, false],
    [new ConflictError('exists'), 'CONFLICT', 409, false],
    [new CycleError(['api', 'auth', 'api']), 'DEPENDENCY_CYCLE', 409, false],
    [new CapacityError('full'), 'CAPACITY_EXCEEDED', 429, true],
    [new MetadataUnavailableError(), 'METADATA_UNAVAILABLE', 503, true],
    [new MetadataStaleError(), 'METADATA_STALE', 503, true],
  ])(
    'exposes stable structured fields for %s',
    (error, code, statusCode, retryable) => {
      expect(error).toMatchObject({ code, statusCode, retryable });
    },
  );
});
