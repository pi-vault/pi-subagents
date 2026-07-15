export const DEFAULT_GLOBAL_CONCURRENCY_LIMIT = 20;

export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, Math.floor(limit) || 1);
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }
}

/**
 * Map items concurrently with a per-call limit and optional global semaphore.
 * Results are returned in the same order as input items.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  globalSemaphore?: Semaphore,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      if (globalSemaphore) await globalSemaphore.acquire();
      try {
        results[i] = await fn(items[i], i);
      } finally {
        if (globalSemaphore) globalSemaphore.release();
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}
