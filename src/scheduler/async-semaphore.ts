interface Waiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

export class AsyncSemaphore {
  #active = 0;
  readonly #waiters: Waiter[] = [];

  public constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Semaphore capacity must be a positive integer');
    }
  }

  public get active(): number {
    return this.#active;
  }

  public get waiting(): number {
    return this.#waiters.length;
  }

  public acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted === true) {
      return Promise.reject(abortError(signal));
    }
    if (this.#active < this.capacity) {
      this.#active += 1;
      return Promise.resolve(this.#releaseFunction());
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal }),
        ...(signal === undefined
          ? {}
          : {
              onAbort: () => {
                const index = this.#waiters.indexOf(waiter);
                if (index >= 0) {
                  this.#waiters.splice(index, 1);
                  reject(abortError(signal));
                }
              },
            }),
      };
      this.#waiters.push(waiter);
      if (signal !== undefined && waiter.onAbort !== undefined) {
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
    });
  }

  #releaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#active -= 1;
      this.#grantNext();
    };
  }

  #grantNext(): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      return;
    }
    if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    if (waiter.signal?.aborted === true) {
      waiter.reject(abortError(waiter.signal));
      this.#grantNext();
      return;
    }
    this.#active += 1;
    waiter.resolve(this.#releaseFunction());
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Semaphore acquisition aborted');
}
