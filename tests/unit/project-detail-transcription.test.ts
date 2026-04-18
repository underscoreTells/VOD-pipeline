import { describe, expect, it, vi } from "vitest";
import {
  autoTranscribeChapters,
  checkTranscriptionAvailability,
  transcribeMissingChaptersOnReopen,
} from "../../src/renderer/lib/components/project-detail-transcription.js";

describe("project detail transcription helpers", () => {
  it("marks all requested chapters when the backend is unavailable", async () => {
    const setTranscriptionError = vi.fn();

    const available = await checkTranscriptionAvailability(
      [1, 2],
      {
        getTranscriptionStatus: vi.fn().mockResolvedValue({
          success: false,
          error: "missing whisper",
        }),
        setTranscriptionError,
      }
    );

    expect(available).toBe(false);
    expect(setTranscriptionError).toHaveBeenCalledTimes(2);
    expect(setTranscriptionError).toHaveBeenNthCalledWith(1, 1, "missing whisper");
    expect(setTranscriptionError).toHaveBeenNthCalledWith(2, 2, "missing whisper");
  });

  it("starts background transcriptions after a successful availability check", async () => {
    const startChapterTranscription = vi.fn().mockResolvedValue({ success: true });

    await autoTranscribeChapters(
      [11, 12],
      {
        getTranscriptionStatus: vi.fn().mockResolvedValue({
          success: true,
          data: { available: true },
        }),
        startChapterTranscription,
        setTranscriptionError: vi.fn(),
      },
      { awaitCompletion: true }
    );

    expect(startChapterTranscription).toHaveBeenNthCalledWith(1, 11, undefined);
    expect(startChapterTranscription).toHaveBeenNthCalledWith(2, 12, undefined);
  });

  it("reopens projects with skip-if-exists transcription requests", async () => {
    const startChapterTranscription = vi.fn().mockResolvedValue({ success: true });

    await transcribeMissingChaptersOnReopen(
      [3],
      {
        getTranscriptionStatus: vi.fn().mockResolvedValue({
          success: true,
          data: { available: true },
        }),
        startChapterTranscription,
        setTranscriptionError: vi.fn(),
      }
    );

    expect(startChapterTranscription).toHaveBeenCalledWith(3, { skipIfExists: true });
  });
});
