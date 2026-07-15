import { describe, it, expect } from "vitest";
import { Semaphore, mapConcurrent } from "../src/core/semaphore.js";

describe("Semaphore", () => {
  it("allows up to limit concurrent acquires", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, () =>
      (async () => {
        await sem.acquire();
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        sem.release();
      })(),
    );
    await Promise.all(tasks);

    expect(maxRunning).toBe(2);
  });

  it("release unblocks waiting acquire", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const waiting = sem.acquire().then(() => { acquired = true; });

    expect(acquired).toBe(false);
    sem.release();
    await waiting;
    expect(acquired).toBe(true);
    sem.release();
  });

  it("floors invalid limits to 1", () => {
    const sem = new Semaphore(0);
    // Should not throw — treated as limit=1
    expect(sem.acquire()).resolves.toBeUndefined();
  });
});

describe("mapConcurrent", () => {
  it("respects per-step limit", async () => {
    let maxConcurrent = 0;
    let current = 0;

    await mapConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 10));
      current--;
      return item * 2;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("respects global semaphore", async () => {
    const globalSem = new Semaphore(1);
    let maxConcurrent = 0;
    let current = 0;

    await mapConcurrent(
      [1, 2, 3],
      3,
      async (item) => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        await new Promise((r) => setTimeout(r, 10));
        current--;
        return item;
      },
      globalSem,
    );

    expect(maxConcurrent).toBe(1);
  });

  it("returns results in order", async () => {
    const results = await mapConcurrent([3, 1, 2], 2, async (item) => {
      await new Promise((r) => setTimeout(r, item * 5));
      return item * 10;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("handles empty input", async () => {
    const results = await mapConcurrent([], 4, async (item) => item);
    expect(results).toEqual([]);
  });

  it("handles zero or negative limit by treating it as 1", async () => {
    const results = await mapConcurrent([1, 2, 3], 0, async (item) => item * 2);
    expect(results).toEqual([2, 4, 6]);
  });
});
