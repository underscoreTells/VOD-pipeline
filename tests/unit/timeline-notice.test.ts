import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTimeline,
  clearTimelineNotice,
  showTimelineNotice,
  timelineState,
} from "../../src/renderer/lib/state/timeline.svelte.js";

describe("timeline notice state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearTimeline();
  });

  afterEach(() => {
    clearTimeline();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("sets the notice immediately", () => {
    showTimelineNotice("Waveform preview unavailable. Timeline editing still works.");

    expect(timelineState.notice).toEqual({
      message: "Waveform preview unavailable. Timeline editing still works.",
    });
  });

  it("auto-clears the notice after the default delay", () => {
    showTimelineNotice("Notice");

    vi.advanceTimersByTime(3999);
    expect(timelineState.notice).toEqual({ message: "Notice" });

    vi.advanceTimersByTime(1);
    expect(timelineState.notice).toBeNull();
  });

  it("resets the hide timer when the notice is shown again", () => {
    showTimelineNotice("First");

    vi.advanceTimersByTime(2000);
    showTimelineNotice("Second");

    vi.advanceTimersByTime(2000);
    expect(timelineState.notice).toEqual({ message: "Second" });

    vi.advanceTimersByTime(2000);
    expect(timelineState.notice).toBeNull();
  });

  it("clears both state and timer when dismissed manually", () => {
    showTimelineNotice("Dismiss me");

    clearTimelineNotice();
    vi.advanceTimersByTime(4000);

    expect(timelineState.notice).toBeNull();
  });

  it("clears the notice and timer when the timeline resets", () => {
    showTimelineNotice("Reset me");

    clearTimeline();
    vi.advanceTimersByTime(4000);

    expect(timelineState.notice).toBeNull();
  });
});
