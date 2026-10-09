import { BoundedJobQueue } from '../../src/scheduler/bounded-job-queue.js';

describe('BoundedJobQueue', () => {
  test('preserves FIFO order up to its exact capacity', () => {
    const queue = new BoundedJobQueue<string>(2);

    queue.enqueue('first');
    queue.enqueue('second');

    expect(queue.depth).toBe(2);
    expect(queue.isFull).toBe(true);
    expect(() => queue.enqueue('third')).toThrow(
      'Deployment queue capacity exceeded',
    );
    expect(queue.dequeue()).toBe('first');
    expect(queue.dequeue()).toBe('second');
    expect(queue.dequeue()).toBeUndefined();
    expect(queue.depth).toBe(0);
  });
});
