import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cancelHeavyMediaJob,
  configureHeavyMediaScheduler,
  enqueueHeavyMediaJob,
  isCancellationError,
  resetHeavyMediaScheduler,
  subscribeHeavyMediaJob,
} from "../../src/electron/ipc/support/heavy-media-queue.js";

// The heavy media queue is a module-level singleton. Tests pin every pool to a
// single slot so the "occupy the slot, then enqueue a second job" pattern
// holds deterministically. Each test uses unique keys and must drain the queue
// before finishing; afterEach resets the scheduler as a safety net.

function flushPending(): Promise<void> {
  // A macrotask delay lets every pending microtask (the queue pump's
  // .then/.catch/.finally chain) settle before the next assertion.
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetHeavyMediaScheduler();
  configureHeavyMediaScheduler({
    cpuProxy: 1,
    gpuProxy: 1,
    transcription: 1,
    fullReverse: 1,
    interactiveOverflow: 1,
  });
});

afterEach(async () => {
  await flushPending();
  resetHeavyMediaScheduler();
});

// A fake job whose run fn resolves once the signal aborts, mirroring how the
// real pipeline run fns cooperate with cancellation.
function resolveOnAbort<T>(value: T): (signal: AbortSignal) => Promise<T> {
  return (signal: AbortSignal) =>
    new Promise<T>((resolve) => {
      if (signal.aborted) {
        resolve(value);
        return;
      }
      signal.addEventListener("abort", () => resolve(value), { once: true });
    });
}

describe("heavy media queue cancellation", () => {
  it("returns false for an unknown key", () => {
    expect(cancelHeavyMediaJob("no-such-job-key")).toBe(false);
  });

  it("rejects and removes a queued (not-started) job", async () => {
    const blockerKey = "cancel-queued:blocker";
    const queuedKey = "cancel-queued:job";

    // Occupy the single concurrency slot so the second job stays queued.
    const blockerPromise = enqueueHeavyMediaJob(
      blockerKey,
      "chapterProxy",
      "background",
      resolveOnAbort(undefined)
    );
    const queuedPromise = enqueueHeavyMediaJob(
      queuedKey,
      "chapterProxy",
      "background",
      resolveOnAbort(undefined)
    );

    expect(cancelHeavyMediaJob(queuedKey)).toBe(true);

    await expect(queuedPromise).rejects.toThrow(/cancelled/i);
    await expect(queuedPromise).rejects.toSatisfy((error: unknown) =>
      isCancellationError(error)
    );

    // Removed from the registry: a second cancel returns false.
    expect(cancelHeavyMediaJob(queuedKey)).toBe(false);

    // Drain the blocker so the next test starts with an idle queue.
    expect(cancelHeavyMediaJob(blockerKey)).toBe(true);
    await blockerPromise;
    await flushPending();
  });

  it("aborts the signal of a running job", async () => {
    const runningKey = "cancel-running:job";
    let capturedSignal: AbortSignal | undefined;

    const runningPromise = enqueueHeavyMediaJob(
      runningKey,
      "chapterProxy",
      "background",
      (signal: AbortSignal) => {
        capturedSignal = signal;
        return resolveOnAbort(undefined)(signal);
      }
    );

    // The job starts synchronously on enqueue (the slot was idle).
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    expect(cancelHeavyMediaJob(runningKey)).toBe(true);
    expect(capturedSignal!.aborted).toBe(true);

    // The run fn resolves on abort, so the job promise resolves cleanly.
    await runningPromise;
    await flushPending();

    // After draining, the job is gone from the registry.
    expect(cancelHeavyMediaJob(runningKey)).toBe(false);
  });

  it("keeps a deduplicated job running until its last subscription is cancelled", async () => {
    const key = "subscription-cancel:shared";
    let capturedSignal: AbortSignal | undefined;
    let runCallCount = 0;
    const run = (signal: AbortSignal) => {
      runCallCount += 1;
      capturedSignal = signal;
      return resolveOnAbort("aborted")(signal);
    };
    const first = subscribeHeavyMediaJob(key, "waveformBlock", "background", run);
    const second = subscribeHeavyMediaJob(key, "waveformBlock", "interactive", run);

    expect(runCallCount).toBe(1);
    expect(first.cancel()).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);
    await expect(first.promise).rejects.toSatisfy((error: unknown) => isCancellationError(error));

    expect(second.cancel()).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
    await expect(second.promise).rejects.toSatisfy((error: unknown) => isCancellationError(error));
  });

  it("does not abort a shared job when a persistent consumer remains", async () => {
    const key = "subscription-cancel:persistent";
    let capturedSignal: AbortSignal | undefined;
    let resolveJob!: (value: string) => void;
    const run = (signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<string>((resolve) => {
        resolveJob = resolve;
      });
    };
    const persistent = enqueueHeavyMediaJob(key, "waveformBlock", "background", run);
    const subscription = subscribeHeavyMediaJob(key, "waveformBlock", "interactive", run);

    expect(subscription.cancel()).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);
    await expect(subscription.promise).rejects.toSatisfy((error: unknown) => isCancellationError(error));

    resolveJob("complete");
    await expect(persistent).resolves.toBe("complete");
  });

  it("re-runs fresh when re-enqueued with the same key after cancellation", async () => {
    const dedupeKey = "dedupe-after-cancel:job";
    let runCallCount = 0;

    const firstPromise = enqueueHeavyMediaJob(
      dedupeKey,
      "chapterProxy",
      "background",
      (signal: AbortSignal) => {
        runCallCount += 1;
        return resolveOnAbort(undefined)(signal);
      }
    );
    expect(runCallCount).toBe(1);

    expect(cancelHeavyMediaJob(dedupeKey)).toBe(true);
    await firstPromise;
    await flushPending();

    let secondSignal: AbortSignal | undefined;
    const secondPromise = enqueueHeavyMediaJob(
      dedupeKey,
      "chapterProxy",
      "background",
      (signal: AbortSignal) => {
        runCallCount += 1;
        secondSignal = signal;
        return Promise.resolve("fresh-value");
      }
    );

    // A fresh run fn invocation happened (not a dedupe to the old promise).
    expect(runCallCount).toBe(2);
    expect(secondSignal).toBeDefined();
    expect(secondSignal!.aborted).toBe(false);

    const result = await secondPromise;
    expect(result).toBe("fresh-value");
  });

  it("creates a fresh subscription while an aborted job is still settling", async () => {
    configureHeavyMediaScheduler({ interactiveOverflow: 0 });
    const key = "subscription-cancel:resubscribe";
    let settleCancelledJob!: () => void;
    let firstSignal: AbortSignal | undefined;
    const first = subscribeHeavyMediaJob(key, "waveformBlock", "interactive", (signal) => {
      firstSignal = signal;
      return new Promise<string>((resolve) => {
        settleCancelledJob = () => resolve("cancelled");
      });
    });

    expect(first.cancel()).toBe(true);
    expect(firstSignal?.aborted).toBe(true);
    await expect(first.promise).rejects.toSatisfy((error: unknown) => isCancellationError(error));

    let secondSignal: AbortSignal | undefined;
    const second = subscribeHeavyMediaJob(key, "waveformBlock", "interactive", (signal) => {
      secondSignal = signal;
      return Promise.resolve("fresh");
    });
    expect(secondSignal).toBeUndefined();

    settleCancelledJob();
    await flushPending();

    expect(secondSignal).toBeDefined();
    expect(secondSignal?.aborted).toBe(false);
    await expect(second.promise).resolves.toBe("fresh");
  });
});
