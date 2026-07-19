import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HeavyMediaCancellationError,
  cancelHeavyMediaJob,
  configureHeavyMediaScheduler,
  enqueueHeavyMediaJob,
  getHeavyMediaSchedulerLimits,
  isCancellationError,
  promoteHeavyMediaJob,
  resetHeavyMediaScheduler,
} from "../../src/electron/ipc/support/heavy-media-queue.js";

// The heavy media queue is a module-level singleton. Every test configures the
// resource limits it needs for determinism and resets the scheduler afterward.
// Jobs are driven by gated run functions so start/finish ordering is observed
// synchronously without real timers.

function flushPending(): Promise<void> {
  // Drain the pump's microtask chain (.then -> .finally -> next pump) by
  // yielding a couple of macrotasks.
  return new Promise<void>((resolve) => {
    setImmediate(() => setImmediate(() => resolve()));
  });
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

interface GatedJob<T> {
  run: (signal: AbortSignal) => Promise<T>;
  finish: () => void;
  readonly signal: AbortSignal | undefined;
  readonly isStarted: boolean;
}

function gatedJob<T>(value: T): GatedJob<T> {
  let resolveFinish!: () => void;
  let capturedSignal: AbortSignal | undefined;
  let startedFlag = false;
  const finishGate = new Promise<void>((resolve) => {
    resolveFinish = resolve;
  });
  const run = (signal: AbortSignal): Promise<T> => {
    capturedSignal = signal;
    startedFlag = true;
    return Promise.race([finishGate.then(() => value), aborted(signal).then(() => value)]);
  };
  return {
    run,
    finish: () => resolveFinish(),
    get signal() {
      return capturedSignal;
    },
    get isStarted() {
      return startedFlag;
    },
  };
}

interface TrackedJob<T> extends GatedJob<T> {
  readonly key: string;
}

function trackedJob<T>(key: string, value: T, startOrder: string[]): TrackedJob<T> {
  const base = gatedJob(value);
  const run = (signal: AbortSignal): Promise<T> => {
    startOrder.push(key);
    return base.run(signal);
  };
  return {
    run,
    finish: base.finish,
    get signal() {
      return base.signal;
    },
    get isStarted() {
      return base.isStarted;
    },
    key,
  };
}

function configure(limits: {
  cpuProxy?: number;
  gpuProxy?: number;
  transcription?: number;
  fullReverse?: number;
  interactiveOverflow?: number;
}): void {
  configureHeavyMediaScheduler(limits);
}

beforeEach(() => {
  resetHeavyMediaScheduler();
});

afterEach(async () => {
  await flushPending();
  resetHeavyMediaScheduler();
});

describe("heavy media scheduler resource pools", () => {
  it("limits cpu proxy jobs to the cpu proxy pool size", async () => {
    configure({ cpuProxy: 2 });
    const a = trackedJob("cpu:a", "a", []);
    const b = trackedJob("cpu:b", "b", []);
    const c = trackedJob("cpu:c", "c", []);

    enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    enqueueHeavyMediaJob(b.key, "chapterProxy", "background", b.run);
    enqueueHeavyMediaJob(c.key, "chapterProxy", "background", c.run);

    expect(a.isStarted).toBe(true);
    expect(b.isStarted).toBe(true);
    expect(c.isStarted).toBe(false);

    b.finish();
    await flushPending();

    expect(c.isStarted).toBe(true);

    a.finish();
    c.finish();
    await flushPending();
  });

  it("routes gpu jobs to an independent gpu proxy pool", async () => {
    configure({ cpuProxy: 1, gpuProxy: 2 });

    const cpu = trackedJob("cpu:1", "cpu", []);
    const gpu1 = trackedJob("gpu:1", "gpu1", []);
    const gpu2 = trackedJob("gpu:2", "gpu2", []);

    enqueueHeavyMediaJob(cpu.key, "chapterProxy", "background", cpu.run);
    enqueueHeavyMediaJob(gpu1.key, "chapterProxy", "background", gpu1.run, { resourceClass: "gpu" });
    enqueueHeavyMediaJob(gpu2.key, "chapterProxy", "background", gpu2.run, { resourceClass: "gpu" });

    expect(cpu.isStarted).toBe(true);
    expect(gpu1.isStarted).toBe(true);
    expect(gpu2.isStarted).toBe(true);

    cpu.finish();
    gpu1.finish();
    gpu2.finish();
    await flushPending();
  });

  it("requeues a GPU fallback under CPU capacity", async () => {
    configure({ cpuProxy: 1, gpuProxy: 1, interactiveOverflow: 0 });

    const cpuBlocker = trackedJob("fallback:cpu-blocker", "blocker", []);
    const cpuFallback = trackedJob("fallback:cpu-retry", "fallback", []);
    const nextGpu = trackedJob("fallback:next-gpu", "gpu", []);
    const fallbackError = new Error("GPU fallback requested");

    const blockerPromise = enqueueHeavyMediaJob(
      cpuBlocker.key,
      "chapterProxy",
      "background",
      cpuBlocker.run
    );
    const fallbackPromise = enqueueHeavyMediaJob(
      "fallback:proxy",
      "chapterProxy",
      "background",
      async () => {
        throw fallbackError;
      },
      {
        resourceClass: "gpu",
        cpuFallback: {
          shouldFallback: (error) => error === fallbackError,
          run: cpuFallback.run,
        },
      }
    );

    await flushPending();
    expect(cpuFallback.isStarted).toBe(false);

    const nextGpuPromise = enqueueHeavyMediaJob(
      nextGpu.key,
      "chapterProxy",
      "background",
      nextGpu.run,
      { resourceClass: "gpu" }
    );
    expect(nextGpu.isStarted).toBe(true);

    cpuBlocker.finish();
    await blockerPromise;
    await flushPending();
    expect(cpuFallback.isStarted).toBe(true);

    cpuFallback.finish();
    nextGpu.finish();
    await Promise.all([fallbackPromise, nextGpuPromise]);
  });

  it("defaults resourceClass to cpu when no options are passed (backward compatible)", async () => {
    configure({ cpuProxy: 1, gpuProxy: 2 });

    const cpu = trackedJob("default:cpu", "cpu", []);
    const gpuQueued = trackedJob("default:gpu", "gpu", []);

    enqueueHeavyMediaJob(cpu.key, "chapterProxy", "background", cpu.run);
    // No options -> cpu pool, which is already saturated by `cpu`.
    enqueueHeavyMediaJob(gpuQueued.key, "chapterProxy", "background", gpuQueued.run);

    expect(cpu.isStarted).toBe(true);
    expect(gpuQueued.isStarted).toBe(false);

    cpu.finish();
    await flushPending();
    expect(gpuQueued.isStarted).toBe(true);

    gpuQueued.finish();
    await flushPending();
  });

  it("limits transcription to its own pool and ignores resourceClass", async () => {
    configure({ cpuProxy: 4, gpuProxy: 4, transcription: 1 });

    const t1 = trackedJob("tx:1", "t1", []);
    const t2 = trackedJob("tx:2", "t2", []);

    enqueueHeavyMediaJob(t1.key, "transcription", "background", t1.run, { resourceClass: "gpu" });
    enqueueHeavyMediaJob(t2.key, "transcription", "background", t2.run);

    expect(t1.isStarted).toBe(true);
    expect(t2.isStarted).toBe(false);

    t1.finish();
    await flushPending();
    expect(t2.isStarted).toBe(true);

    t2.finish();
    await flushPending();
  });

  it("does not overlap transcription with CPU proxy work", async () => {
    configure({ cpuProxy: 2, gpuProxy: 1, transcription: 1 });

    const cpu = trackedJob("shared-cpu:proxy", "proxy", []);
    const transcription = trackedJob("shared-cpu:transcription", "transcription", []);
    const gpu = trackedJob("shared-cpu:gpu", "gpu", []);

    const cpuPromise = enqueueHeavyMediaJob(cpu.key, "chapterProxy", "background", cpu.run);
    const transcriptionPromise = enqueueHeavyMediaJob(
      transcription.key,
      "transcription",
      "background",
      transcription.run
    );
    const gpuPromise = enqueueHeavyMediaJob(gpu.key, "chapterProxy", "background", gpu.run, {
      resourceClass: "gpu",
    });

    expect(cpu.isStarted).toBe(true);
    expect(transcription.isStarted).toBe(false);
    expect(gpu.isStarted).toBe(true);

    cpu.finish();
    await cpuPromise;
    await flushPending();
    expect(transcription.isStarted).toBe(true);

    transcription.finish();
    gpu.finish();
    await Promise.all([transcriptionPromise, gpuPromise]);
  });

  it("holds CPU proxies while transcription is active", async () => {
    configure({ cpuProxy: 2, transcription: 1 });

    const transcription = trackedJob("shared-cpu:first-transcription", "transcription", []);
    const cpu = trackedJob("shared-cpu:queued-proxy", "proxy", []);

    const transcriptionPromise = enqueueHeavyMediaJob(
      transcription.key,
      "transcription",
      "background",
      transcription.run
    );
    const cpuPromise = enqueueHeavyMediaJob(cpu.key, "chapterProxy", "background", cpu.run);

    expect(transcription.isStarted).toBe(true);
    expect(cpu.isStarted).toBe(false);

    transcription.finish();
    await transcriptionPromise;
    await flushPending();
    expect(cpu.isStarted).toBe(true);

    cpu.finish();
    await cpuPromise;
  });

  it("drains active CPU proxies before refilling when transcription is waiting", async () => {
    configure({ cpuProxy: 2, transcription: 1 });

    const firstCpu = trackedJob("shared-cpu:first", "first", []);
    const secondCpu = trackedJob("shared-cpu:second", "second", []);
    const queuedCpu = trackedJob("shared-cpu:queued", "queued", []);
    const transcription = trackedJob("shared-cpu:waiting-transcription", "transcription", []);

    const firstPromise = enqueueHeavyMediaJob(firstCpu.key, "chapterProxy", "background", firstCpu.run);
    const secondPromise = enqueueHeavyMediaJob(secondCpu.key, "chapterProxy", "background", secondCpu.run);
    const queuedPromise = enqueueHeavyMediaJob(queuedCpu.key, "chapterProxy", "background", queuedCpu.run);
    const transcriptionPromise = enqueueHeavyMediaJob(
      transcription.key,
      "transcription",
      "interactive",
      transcription.run
    );

    expect(firstCpu.isStarted).toBe(true);
    expect(secondCpu.isStarted).toBe(true);
    expect(queuedCpu.isStarted).toBe(false);
    expect(transcription.isStarted).toBe(false);

    firstCpu.finish();
    await firstPromise;
    await flushPending();
    expect(queuedCpu.isStarted).toBe(false);
    expect(transcription.isStarted).toBe(false);

    secondCpu.finish();
    await secondPromise;
    await flushPending();
    expect(transcription.isStarted).toBe(true);
    expect(queuedCpu.isStarted).toBe(false);

    transcription.finish();
    await transcriptionPromise;
    await flushPending();
    expect(queuedCpu.isStarted).toBe(true);

    queuedCpu.finish();
    await queuedPromise;
  });

  it("repumps CPU proxies after cancelling a waiting transcription", async () => {
    configure({ cpuProxy: 2, transcription: 1 });

    const activeCpu = trackedJob("shared-cpu:active", "active", []);
    const transcription = trackedJob("shared-cpu:cancelled-transcription", "transcription", []);
    const queuedCpu = trackedJob("shared-cpu:blocked", "blocked", []);

    const activePromise = enqueueHeavyMediaJob(activeCpu.key, "chapterProxy", "background", activeCpu.run);
    const transcriptionPromise = enqueueHeavyMediaJob(
      transcription.key,
      "transcription",
      "interactive",
      transcription.run
    );
    const queuedPromise = enqueueHeavyMediaJob(
      queuedCpu.key,
      "chapterProxy",
      "background",
      queuedCpu.run
    );

    expect(activeCpu.isStarted).toBe(true);
    expect(transcription.isStarted).toBe(false);
    expect(queuedCpu.isStarted).toBe(false);

    const cancelled = expect(transcriptionPromise).rejects.toBeInstanceOf(HeavyMediaCancellationError);
    expect(cancelHeavyMediaJob(transcription.key)).toBe(true);
    await cancelled;
    expect(queuedCpu.isStarted).toBe(true);

    activeCpu.finish();
    queuedCpu.finish();
    await Promise.all([activePromise, queuedPromise]);
  });
});

describe("heavy media scheduler burst and ordering", () => {
  it("starts only up to the limit on a synchronous burst, then drains the rest", async () => {
    configure({ cpuProxy: 2 });
    const order: string[] = [];
    const jobs = Array.from({ length: 5 }, (_, i) =>
      trackedJob(`burst:${i}`, i, order)
    );

    for (const job of jobs) {
      enqueueHeavyMediaJob(job.key, "chapterProxy", "background", job.run);
    }

    expect(jobs.filter((j) => j.isStarted)).toHaveLength(2);

    for (const job of jobs) {
      job.finish();
    }
    await flushPending();

    expect(order).toHaveLength(5);
    expect(order).toEqual(["burst:0", "burst:1", "burst:2", "burst:3", "burst:4"]);
  });

  it("runs same-priority jobs in FIFO (enqueue) order", async () => {
    configure({ cpuProxy: 1 });
    const order: string[] = [];
    const a = trackedJob("fifo:a", "a", order);
    const b = trackedJob("fifo:b", "b", order);
    const c = trackedJob("fifo:c", "c", order);

    enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    enqueueHeavyMediaJob(b.key, "chapterProxy", "background", b.run);
    enqueueHeavyMediaJob(c.key, "chapterProxy", "background", c.run);

    expect(order).toEqual(["fifo:a"]);

    a.finish();
    await flushPending();
    expect(order).toEqual(["fifo:a", "fifo:b"]);

    b.finish();
    await flushPending();
    expect(order).toEqual(["fifo:a", "fifo:b", "fifo:c"]);

    c.finish();
    await flushPending();
  });

  it("promotes interactive jobs ahead of queued background jobs", async () => {
    // Disable the overflow slot so the interactive job must wait for a base
    // slot; when one frees it should jump the queued background job.
    configure({ cpuProxy: 1, interactiveOverflow: 0 });
    const order: string[] = [];
    const a = trackedJob("prio:a", "a", order);
    const b = trackedJob("prio:b", "b", order);
    const c = trackedJob("prio:c", "c", order);

    enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    enqueueHeavyMediaJob(b.key, "chapterProxy", "background", b.run);
    enqueueHeavyMediaJob(c.key, "chapterProxy", "interactive", c.run);

    expect(order).toEqual(["prio:a"]);

    a.finish();
    await flushPending();
    // The interactive job jumps the queued background job.
    expect(order).toEqual(["prio:a", "prio:c"]);

    c.finish();
    await flushPending();
    expect(order).toEqual(["prio:a", "prio:c", "prio:b"]);

    b.finish();
    await flushPending();
  });
});

describe("heavy media scheduler promotion and dedupe", () => {
  it("promotes a queued job when re-enqueued with higher priority", async () => {
    configure({ cpuProxy: 1 });
    const order: string[] = [];
    const a = trackedJob("re:a", "a", order);
    const b = trackedJob("re:b", "b", order);

    const blocker = enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    const firstPromise = enqueueHeavyMediaJob(b.key, "chapterProxy", "background", b.run);

    // Re-enqueue the same key with interactive priority: same promise, promoted.
    const secondPromise = enqueueHeavyMediaJob(b.key, "chapterProxy", "interactive", b.run);
    expect(secondPromise).toBe(firstPromise);

    a.finish();
    await flushPending();
    expect(order).toEqual(["re:a", "re:b"]);

    b.finish();
    await blocker;
    await firstPromise;
    await flushPending();
  });

  it("promoteHeavyMediaJob upgrades a queued background job to interactive", async () => {
    configure({ cpuProxy: 1 });
    const order: string[] = [];
    const a = trackedJob("promote:a", "a", order);
    const b = trackedJob("promote:b", "b", order);

    enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    enqueueHeavyMediaJob(b.key, "chapterProxy", "background", b.run);

    promoteHeavyMediaJob(b.key);
    expect(order).toEqual(["promote:a", "promote:b"]);
    // Unknown key and already-started jobs are no-ops.
    promoteHeavyMediaJob("promote:unknown");
    promoteHeavyMediaJob(a.key);

    a.finish();
    await flushPending();
    expect(order).toEqual(["promote:a", "promote:b"]);

    b.finish();
    await flushPending();
  });

  it("dedupes by key: re-enqueue returns the same promise and does not double-run", async () => {
    configure({ cpuProxy: 2 });
    const order: string[] = [];
    const a = trackedJob("dedupe:a", "a", order);

    const first = enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    const second = enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    const third = enqueueHeavyMediaJob(a.key, "chapterProxy", "interactive", a.run);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(order).toEqual(["dedupe:a"]);

    a.finish();
    await first;
    await flushPending();
    expect(order).toEqual(["dedupe:a"]);
  });
});

describe("heavy media scheduler cancellation", () => {
  it("returns false for an unknown key", () => {
    expect(cancelHeavyMediaJob("cancel:unknown")).toBe(false);
  });

  it("rejects and removes a queued job; second cancel returns false", async () => {
    configure({ cpuProxy: 1 });
    const blocker = trackedJob("cq:blocker", "blocker", []);
    const queued = trackedJob("cq:queued", "queued", []);

    const blockerPromise = enqueueHeavyMediaJob(blocker.key, "chapterProxy", "background", blocker.run);
    const queuedPromise = enqueueHeavyMediaJob(queued.key, "chapterProxy", "background", queued.run);

    expect(queued.isStarted).toBe(false);
    expect(cancelHeavyMediaJob(queued.key)).toBe(true);

    await expect(queuedPromise).rejects.toThrow(/cancelled/i);
    await expect(queuedPromise).rejects.toBeInstanceOf(HeavyMediaCancellationError);
    await expect(queuedPromise).rejects.toSatisfy((error: unknown) => isCancellationError(error));

    expect(cancelHeavyMediaJob(queued.key)).toBe(false);

    blocker.finish();
    await blockerPromise;
    await flushPending();
  });

  it("aborts the signal of a running job and releases its slot", async () => {
    configure({ cpuProxy: 1 });
    const a = trackedJob("cr:a", "a", []);
    const b = trackedJob("cr:b", "b", []);

    const aPromise = enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    enqueueHeavyMediaJob(b.key, "chapterProxy", "background", b.run);

    expect(a.isStarted).toBe(true);
    expect(b.isStarted).toBe(false);
    expect(a.signal).toBeDefined();
    expect(a.signal!.aborted).toBe(false);

    expect(cancelHeavyMediaJob(a.key)).toBe(true);
    expect(a.signal!.aborted).toBe(true);

    // The cooperative run resolves on abort; the freed slot lets `b` start.
    await aPromise;
    await flushPending();
    expect(b.isStarted).toBe(true);

    b.finish();
    await flushPending();
    expect(cancelHeavyMediaJob(a.key)).toBe(false);
  });

  it("re-runs fresh when re-enqueued with the same key after running-job cancellation", async () => {
    configure({ cpuProxy: 1 });
    const order: string[] = [];
    const a = trackedJob("rerun:a", "a", order);

    const first = enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    expect(order).toEqual(["rerun:a"]);

    cancelHeavyMediaJob(a.key);
    await first;
    await flushPending();

    const second = enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    expect(order).toEqual(["rerun:a", "rerun:a"]);

    a.finish();
    await second;
    await flushPending();
  });
});

describe("heavy media scheduler interactive overflow", () => {
  it("lets one interactive proxy exceed the background proxy limit", async () => {
    configure({ cpuProxy: 2, interactiveOverflow: 1 });
    const bg1 = trackedJob("ov:bg1", "bg1", []);
    const bg2 = trackedJob("ov:bg2", "bg2", []);
    const inter1 = trackedJob("ov:inter1", "inter1", []);
    const inter2 = trackedJob("ov:inter2", "inter2", []);

    enqueueHeavyMediaJob(bg1.key, "chapterProxy", "background", bg1.run);
    enqueueHeavyMediaJob(bg2.key, "chapterProxy", "background", bg2.run);
    enqueueHeavyMediaJob(inter1.key, "chapterProxy", "interactive", inter1.run);

    expect(bg1.isStarted && bg2.isStarted && inter1.isStarted).toBe(true);

    // A second interactive job cannot use the (already taken) overflow slot.
    enqueueHeavyMediaJob(inter2.key, "chapterProxy", "interactive", inter2.run);
    expect(inter2.isStarted).toBe(false);

    bg1.finish();
    await flushPending();
    expect(inter2.isStarted).toBe(true);

    bg2.finish();
    inter1.finish();
    inter2.finish();
    await flushPending();
  });

  it("does not let background jobs use the overflow slot", async () => {
    configure({ cpuProxy: 1, interactiveOverflow: 1 });
    const bg1 = trackedJob("nb:bg1", "bg1", []);
    const bg2 = trackedJob("nb:bg2", "bg2", []);
    const inter = trackedJob("nb:inter", "inter", []);

    enqueueHeavyMediaJob(bg1.key, "chapterProxy", "background", bg1.run);
    enqueueHeavyMediaJob(bg2.key, "chapterProxy", "background", bg2.run);
    enqueueHeavyMediaJob(inter.key, "chapterProxy", "interactive", inter.run);

    expect(bg1.isStarted).toBe(true);
    expect(inter.isStarted).toBe(true);
    expect(bg2.isStarted).toBe(false);

    bg1.finish();
    await flushPending();
    expect(bg2.isStarted).toBe(true);

    inter.finish();
    bg2.finish();
    await flushPending();
  });

  it("reclaims a freed base slot while an interactive overflow job is still running", async () => {
    configure({ cpuProxy: 1, interactiveOverflow: 1 });
    const bg1 = trackedJob("base:bg1", "bg1", []);
    const inter = trackedJob("base:inter", "inter", []);
    const bg2 = trackedJob("base:bg2", "bg2", []);

    enqueueHeavyMediaJob(bg1.key, "chapterProxy", "background", bg1.run);
    enqueueHeavyMediaJob(inter.key, "chapterProxy", "interactive", inter.run);
    enqueueHeavyMediaJob(bg2.key, "chapterProxy", "background", bg2.run);

    expect(bg1.isStarted).toBe(true);
    expect(inter.isStarted).toBe(true);
    expect(bg2.isStarted).toBe(false);

    // Free the base slot; the overflow job keeps running, but the base slot is
    // available again, so the queued background job may start.
    bg1.finish();
    await flushPending();
    expect(bg2.isStarted).toBe(true);
    expect(inter.isStarted).toBe(true);

    inter.finish();
    bg2.finish();
    await flushPending();
  });

  it("keeps gpu proxy interactive overflow independent of the cpu proxy", async () => {
    configure({ cpuProxy: 1, gpuProxy: 1, interactiveOverflow: 1 });
    const cpuBg = trackedJob("xcpu:bg", "cpu", []);
    const cpuInter = trackedJob("xcpu:inter", "cpuInter", []);
    const gpuBg = trackedJob("xgpu:bg", "gpu", []);
    const gpuInter = trackedJob("xgpu:inter", "gpuInter", []);

    enqueueHeavyMediaJob(cpuBg.key, "chapterProxy", "background", cpuBg.run);
    enqueueHeavyMediaJob(cpuInter.key, "chapterProxy", "interactive", cpuInter.run);
    enqueueHeavyMediaJob(gpuBg.key, "chapterProxy", "background", gpuBg.run, { resourceClass: "gpu" });
    enqueueHeavyMediaJob(gpuInter.key, "chapterProxy", "interactive", gpuInter.run, { resourceClass: "gpu" });

    expect([cpuBg.isStarted, cpuInter.isStarted, gpuBg.isStarted, gpuInter.isStarted]).toEqual([
      true,
      true,
      true,
      true,
    ]);

    cpuBg.finish();
    cpuInter.finish();
    gpuBg.finish();
    gpuInter.finish();
    await flushPending();
  });
});

describe("heavy media scheduler reverse jobs", () => {
  it("runs at most one full reverse job at a time even with spare proxy slots", async () => {
    configure({ cpuProxy: 4, fullReverse: 1 });
    const a = trackedJob("fr:a", "a", []);
    const b = trackedJob("fr:b", "b", []);

    enqueueHeavyMediaJob(a.key, "reverseFullWarm", "background", a.run);
    enqueueHeavyMediaJob(b.key, "reverseFullWarm", "background", b.run);

    expect(a.isStarted).toBe(true);
    expect(b.isStarted).toBe(false);

    a.finish();
    await flushPending();
    expect(b.isStarted).toBe(true);

    b.finish();
    await flushPending();
  });

  it("still starts unrelated proxy jobs while a full reverse blocks a second one", async () => {
    configure({ cpuProxy: 4, fullReverse: 1 });
    const fullA = trackedJob("fb:fullA", "fullA", []);
    const fullB = trackedJob("fb:fullB", "fullB", []);
    const chapter = trackedJob("fb:chapter", "chapter", []);

    enqueueHeavyMediaJob(fullA.key, "reverseFullWarm", "background", fullA.run);
    enqueueHeavyMediaJob(fullB.key, "reverseFullWarm", "background", fullB.run);
    enqueueHeavyMediaJob(chapter.key, "chapterProxy", "background", chapter.run);

    expect(fullA.isStarted).toBe(true);
    expect(fullB.isStarted).toBe(false);
    expect(chapter.isStarted).toBe(true);

    fullA.finish();
    await flushPending();
    expect(fullB.isStarted).toBe(true);

    fullB.finish();
    chapter.finish();
    await flushPending();
  });

  it("reverse quick jobs share the cpu proxy pool with chapter proxies", async () => {
    configure({ cpuProxy: 2, fullReverse: 1 });
    const chap1 = trackedJob("share:chap1", "chap1", []);
    const chap2 = trackedJob("share:chap2", "chap2", []);
    const reverse = trackedJob("share:reverse", "reverse", []);

    enqueueHeavyMediaJob(chap1.key, "chapterProxy", "background", chap1.run);
    enqueueHeavyMediaJob(chap2.key, "chapterProxy", "background", chap2.run);
    enqueueHeavyMediaJob(reverse.key, "reverseQuickWarm", "background", reverse.run);

    expect(chap1.isStarted && chap2.isStarted).toBe(true);
    expect(reverse.isStarted).toBe(false);

    chap1.finish();
    await flushPending();
    expect(reverse.isStarted).toBe(true);

    chap2.finish();
    reverse.finish();
    await flushPending();
  });

  it("reverse quick jobs share the gpu proxy pool when routed to gpu", async () => {
    configure({ cpuProxy: 4, gpuProxy: 1, fullReverse: 1 });
    const gpuChapter = trackedJob("gshare:chapter", "chapter", []);
    const gpuReverse = trackedJob("gshare:reverse", "reverse", []);

    enqueueHeavyMediaJob(gpuChapter.key, "chapterProxy", "background", gpuChapter.run, {
      resourceClass: "gpu",
    });
    enqueueHeavyMediaJob(gpuReverse.key, "reverseQuickWarm", "background", gpuReverse.run, {
      resourceClass: "gpu",
    });

    expect(gpuChapter.isStarted).toBe(true);
    expect(gpuReverse.isStarted).toBe(false);

    gpuChapter.finish();
    await flushPending();
    expect(gpuReverse.isStarted).toBe(true);

    gpuReverse.finish();
    await flushPending();
  });
});

describe("heavy media scheduler configuration", () => {
  it("exposes configured limits and restores defaults on reset", () => {
    configure({ cpuProxy: 5, gpuProxy: 3, transcription: 2, fullReverse: 1, interactiveOverflow: 4 });
    expect(getHeavyMediaSchedulerLimits()).toEqual({
      cpuProxy: 5,
      gpuProxy: 3,
      transcription: 2,
      fullReverse: 1,
      interactiveOverflow: 4,
    });

    resetHeavyMediaScheduler();
    const restored = getHeavyMediaSchedulerLimits();
    expect(restored.gpuProxy).toBe(1);
    expect(restored.transcription).toBe(1);
    expect(restored.fullReverse).toBe(1);
    expect(restored.interactiveOverflow).toBe(1);
    expect(restored.cpuProxy).toBeGreaterThanOrEqual(1);
    expect(restored.cpuProxy).toBeLessThanOrEqual(2);
  });

  it("applyDefault via reset clears all running/queued state", async () => {
    configure({ cpuProxy: 1 });
    const a = trackedJob("cfg:a", "a", []);
    const b = trackedJob("cfg:b", "b", []);
    enqueueHeavyMediaJob(a.key, "chapterProxy", "background", a.run);
    enqueueHeavyMediaJob(b.key, "chapterProxy", "background", b.run);

    expect(a.isStarted).toBe(true);
    expect(b.isStarted).toBe(false);

    resetHeavyMediaScheduler();
    await flushPending();

    // After reset, the aborted running job settles but the queued job never
    // started, and a fresh enqueue runs immediately on a clean scheduler.
    const fresh = trackedJob("cfg:fresh", "fresh", []);
    const freshPromise = enqueueHeavyMediaJob(fresh.key, "chapterProxy", "background", fresh.run);
    expect(fresh.isStarted).toBe(true);
    fresh.finish();
    await freshPromise;
    await flushPending();
  });
});
