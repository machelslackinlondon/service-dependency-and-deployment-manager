export class OperationalError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends OperationalError {
  public constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
  }
}

export class NotFoundError extends OperationalError {
  public constructor(message: string) {
    super(message, 'NOT_FOUND', 404, false);
  }
}

export class ConflictError extends OperationalError {
  public constructor(message: string) {
    super(message, 'CONFLICT', 409, false);
  }
}

export class CycleError extends OperationalError {
  public readonly path: readonly string[];

  public constructor(path: readonly string[]) {
    super(
      `Dependency cycle detected: ${path.join(' -> ')}`,
      'DEPENDENCY_CYCLE',
      409,
      false,
    );
    this.path = Object.freeze([...path]);
  }
}

export class CapacityError extends OperationalError {
  public constructor(message: string) {
    super(message, 'CAPACITY_EXCEEDED', 429, true);
  }
}

export class MetadataUnavailableError extends OperationalError {
  public constructor(message = 'Dependency metadata is unavailable') {
    super(message, 'METADATA_UNAVAILABLE', 503, true);
  }
}

export class MetadataStaleError extends OperationalError {
  public constructor(message = 'Dependency metadata is stale') {
    super(message, 'METADATA_STALE', 503, true);
  }
}
