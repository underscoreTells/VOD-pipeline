import { describe, expect, it } from "vitest";
import { resolveTimelineWaveformLoadPayload } from "../../src/renderer/lib/utils/timeline-waveform.js";

describe("timeline waveform payload resolution", () => {
  it("returns a real waveform payload when cached waveform data exists", () => {
    const payload = resolveTimelineWaveformLoadPayload({
      waveformData: {
        duration: 10,
        peaks: [
          { min: -0.1, max: 0.1 },
          { min: -0.2, max: 0.2 },
          { min: -0.3, max: 0.3 },
          { min: -0.4, max: 0.4 },
        ],
      },
      chapterRange: { start: 0, end: 4, duration: 4 },
      assetDuration: 10,
    });

    expect(payload).not.toBeNull();
    expect(payload?.hasRealWaveform).toBe(true);
    expect(payload?.duration).toBe(4);
    expect(payload?.peaks).toHaveLength(1);
    expect(payload?.peaks[0]).toBeInstanceOf(Float32Array);
  });

  it("slices real waveform peaks to the selected chapter range", () => {
    const payload = resolveTimelineWaveformLoadPayload({
      waveformData: {
        duration: 10,
        peaks: [
          { min: -0.1, max: 0.1 },
          { min: -0.2, max: 0.2 },
          { min: -0.25, max: 0.25 },
          { min: -0.5, max: 0.5 },
          { min: -0.75, max: 0.75 },
          { min: -0.9, max: 0.9 },
        ],
      },
      chapterRange: { start: 3, end: 5, duration: 2 },
      assetDuration: 10,
    });

    expect(payload).not.toBeNull();
    const [firstPeak, secondPeak] = Array.from(payload!.peaks[0]);
    expect(firstPeak).toBeCloseTo(0.2);
    expect(secondPeak).toBeCloseTo(0.25);
  });

  it("returns a blank fallback payload when waveform data is missing", () => {
    const payload = resolveTimelineWaveformLoadPayload({
      waveformData: null,
      chapterRange: { start: 12, end: 27, duration: 15 },
      assetDuration: null,
    });

    expect(payload).not.toBeNull();
    expect(payload?.hasRealWaveform).toBe(false);
    expect(payload?.duration).toBe(15);
    expect(payload?.peaks).toHaveLength(1);
  });

  it("uses a single zeroed Float32Array for the blank fallback payload", () => {
    const payload = resolveTimelineWaveformLoadPayload({
      waveformData: null,
      chapterRange: { start: 0, end: 8, duration: 8 },
      assetDuration: 42,
    });

    expect(payload).not.toBeNull();
    expect(payload?.peaks[0]).toBeInstanceOf(Float32Array);
    expect(payload?.peaks[0]).toHaveLength(2048);
    expect(Array.from(payload!.peaks[0]).every((value) => value === 0)).toBe(true);
  });

  it("returns null when the chapter range is missing", () => {
    expect(resolveTimelineWaveformLoadPayload({
      waveformData: null,
      chapterRange: null,
      assetDuration: 12,
    })).toBeNull();
  });

  it("returns null when the chapter duration is invalid", () => {
    expect(resolveTimelineWaveformLoadPayload({
      waveformData: null,
      chapterRange: { start: 10, end: 10, duration: 0 },
      assetDuration: 12,
    })).toBeNull();
  });
});
