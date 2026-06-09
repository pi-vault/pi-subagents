import { afterEach, describe, expect, test, vi } from "vitest";
import * as tracker from "../src/core/background-tracker.js";
import * as status from "../src/core/background-status.js";

afterEach(() => {
  tracker.stopBackgroundTracker();
  vi.restoreAllMocks();
});

describe("background tracker", () => {
  test("marks running job failed when pid is gone and no result appears after grace period", () => {
    vi.useFakeTimers();
    vi.spyOn(status, "scanPersistedJobs").mockReturnValue([
      {
        id: "job-1",
        agent: "Scout",
        task: "inspect repo",
        cwd: "/repo",
        state: "running",
        pid: 4242,
        startedAt: Date.now() - 30_000,
      },
    ]);
    vi.spyOn(status, "readResult").mockReturnValue(undefined);
    vi.spyOn(status, "writeStatus").mockImplementation(() => {});
    vi.spyOn(status, "readStatus").mockImplementation((id) =>
      id === "job-1"
        ? {
            id: "job-1",
            agent: "Scout",
            task: "inspect repo",
            cwd: "/repo",
            state: "running",
            pid: 4242,
            startedAt: Date.now() - 30_000,
          }
        : undefined,
    );
    vi.spyOn(process, "kill").mockImplementation(((_pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0) {
        const err = new Error("ESRCH") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      return true;
    }) as never);

    tracker.startBackgroundTracker();
    vi.advanceTimersByTime(1000);

    expect(tracker.getJobStatuses()).toContainEqual(
      expect.objectContaining({
        id: "job-1",
        state: "failed",
        errorMessage: expect.stringContaining("process exited before writing result"),
      }),
    );

    vi.useRealTimers();
  });

  test("startup rebuilds job state from disk instead of keeping stale in-memory jobs", () => {
    vi.spyOn(status, "scanPersistedJobs").mockReturnValue([
      {
        id: "job-fresh",
        agent: "Scout",
        task: "inspect repo",
        cwd: "/repo",
        state: "complete",
        startedAt: Date.now() - 1_000,
        endedAt: Date.now(),
      },
    ]);
    vi.spyOn(status, "readResult").mockReturnValue(undefined);
    vi.spyOn(status, "readStatus").mockReturnValue(undefined);

    tracker.registerJob({
      id: "job-stale",
      agent: "Old",
      task: "stale",
      cwd: "/old",
      state: "running",
      startedAt: Date.now() - 10_000,
    });

    tracker.startBackgroundTracker();

    expect(tracker.getJobStatuses()).toEqual([
      expect.objectContaining({
        id: "job-fresh",
        state: "complete",
      }),
    ]);
  });
});
