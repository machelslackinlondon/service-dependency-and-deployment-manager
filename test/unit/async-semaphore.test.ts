import { AsyncSemaphore } from '../../src/scheduler/async-semaphore.js';

describe('AsyncSemaphore', () => {
  test('grants permits in FIFO order and makes release idempotent', async () => {
    const semaphore = new AsyncSemaphore(1);
    const releaseFirst = await semaphore.acquire();
    const order: string[] = [];
    const second = semaphore.acquire().then((release) => {
      order.push('second');
      return release;
    });
    const third = semaphore.acquire().then((release) => {
      order.push('third');
      return release;
    });

    expect(semaphore.active).toBe(1);
    expect(semaphore.waiting).toBe(2);
    releaseFirst();
    const releaseSecond = await second;
    expect(order).toEqual(['second']);
    releaseFirst();
    expect(semaphore.active).toBe(1);

    releaseSecond();
    const releaseThird = await third;
    expect(order).toEqual(['second', 'third']);
    releaseThird();
    expect(semaphore.active).toBe(0);
    expect(semaphore.waiting).toBe(0);
  });

  test('removes and rejects an aborted waiter', async () => {
    const semaphore = new AsyncSemaphore(1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire(controller.signal);

    controller.abort(new Error('stop waiting'));

    await expect(waiting).rejects.toThrow('stop waiting');
    expect(semaphore.waiting).toBe(0);
    release();
  });
});
