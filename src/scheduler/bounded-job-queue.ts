import { CapacityError } from '../errors.js';

export class BoundedJobQueue<T> {
  readonly #items: T[] = [];
  #head = 0;

  public constructor(public readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Queue capacity must be a positive integer');
    }
  }

  public get depth(): number {
    return this.#items.length - this.#head;
  }

  public get isFull(): boolean {
    return this.depth >= this.capacity;
  }

  public enqueue(item: T): void {
    if (this.isFull) {
      throw new CapacityError('Deployment queue capacity exceeded');
    }
    this.#items.push(item);
  }

  public dequeue(): T | undefined {
    const item = this.#items[this.#head];
    if (item === undefined) {
      return undefined;
    }
    this.#head += 1;
    if (this.#head > 64 && this.#head * 2 >= this.#items.length) {
      this.#items.splice(0, this.#head);
      this.#head = 0;
    }
    return item;
  }
}
