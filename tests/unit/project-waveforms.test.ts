import { beforeEach, describe, expect, it, vi } from "vitest";

const projectDetailMocks = vi.hoisted(() => ({
  projectDetail: {
    assets: [] as Array<Record<string, unknown>>,
    isGeneratingWaveform: false,
    waveformProgress: { assetId: 0, tier: 0, percent: 0, status: "" },
  },
}));

const timelineMocks = vi.hoisted(() => ({
  setError: vi.fn(),
}));

const waveformApiMocks = vi.hoisted(() => {
  let progressHandler: ((event: any) => void) | null = null;

  return {
    generateWaveform: vi.fn(),
    getWaveform: vi.fn(),
    onWaveformProgress: vi.fn((callback: (event: any) => void) => {
      progressHandler = callback;
      return () => {
        progressHandler = null;
      };
    }),
    emitProgress(event: any) {
      progressHandler?.(event);
    },
    resetProgressHandler() {
      progressHandler = null;
    },
  };
});

vi.mock("../../src/renderer/lib/state/project-media.svelte.js", () => projectDetailMocks);
vi.mock("../../src/renderer/lib/state/timeline.svelte", () => timelineMocks);
vi.mock("../../src/renderer/lib/api/waveforms.js", () => waveformApiMocks);

function createAsset(id: number) {
  return {
    id,
    file_path: `/tmp/test-${id}.mp4`,
    availability: { exists: true },
    metadata: { audioTracks: [{ index: 0 }] },
  };
}

describe("project waveform state", () => {
  beforeEach(() => {
    projectDetailMocks.projectDetail.assets = [createAsset(1)];
    projectDetailMocks.projectDetail.isGeneratingWaveform = false;
    projectDetailMocks.projectDetail.waveformProgress = {
      assetId: 0,
      tier: 0,
      percent: 0,
      status: "",
    };

    timelineMocks.setError.mockReset();
    waveformApiMocks.generateWaveform.mockReset();
    waveformApiMocks.getWaveform.mockReset();
    waveformApiMocks.onWaveformProgress.mockClear();
    waveformApiMocks.resetProgressHandler();
  });

  it("does not toggle modal waveform state in background mode", async () => {
    const { generateAssetWaveform } = await import("../../src/renderer/lib/state/project-waveforms.svelte.js");
    waveformApiMocks.generateWaveform.mockResolvedValue({ success: true, data: {} });

    await generateAssetWaveform(1, 0, { playbackActive: true }, { uiMode: "background" });

    expect(waveformApiMocks.generateWaveform).toHaveBeenCalledWith(1, 0, { playbackActive: true });
    expect(projectDetailMocks.projectDetail.isGeneratingWaveform).toBe(false);
    expect(projectDetailMocks.projectDetail.waveformProgress).toEqual({
      assetId: 0,
      tier: 0,
      percent: 0,
      status: "",
    });
  });

  it("shows and updates modal waveform progress in modal mode", async () => {
    const { generateAssetWaveform } = await import("../../src/renderer/lib/state/project-waveforms.svelte.js");
    let resolveGenerate: ((value: unknown) => void) | null = null;
    waveformApiMocks.generateWaveform.mockReturnValue(new Promise((resolve) => {
      resolveGenerate = resolve;
    }));

    const task = generateAssetWaveform(1, 0, {});

    expect(projectDetailMocks.projectDetail.isGeneratingWaveform).toBe(true);
    expect(projectDetailMocks.projectDetail.waveformProgress).toEqual({
      assetId: 1,
      tier: 0,
      percent: 0,
      status: "Starting...",
    });

    waveformApiMocks.emitProgress({
      assetId: 1,
      trackIndex: 0,
      progress: {
        trackIndex: 0,
        tier: 1,
        percent: 42,
        status: "Analyzing...",
      },
    });

    expect(projectDetailMocks.projectDetail.waveformProgress).toEqual({
      assetId: 1,
      tier: 1,
      percent: 42,
      status: "Analyzing...",
    });

    resolveGenerate?.({ success: true, data: {} });
    await task;

    expect(projectDetailMocks.projectDetail.isGeneratingWaveform).toBe(false);
    expect(projectDetailMocks.projectDetail.waveformProgress).toEqual({
      assetId: 1,
      tier: 0,
      percent: 100,
      status: "Complete",
    });
  });

  it("reports errors in background mode without toggling modal state", async () => {
    const { generateAssetWaveform } = await import("../../src/renderer/lib/state/project-waveforms.svelte.js");
    waveformApiMocks.generateWaveform.mockResolvedValue({
      success: false,
      error: "Waveform failed",
    });

    await generateAssetWaveform(1, 0, {}, { uiMode: "background" });

    expect(timelineMocks.setError).toHaveBeenCalledWith("Waveform failed");
    expect(projectDetailMocks.projectDetail.isGeneratingWaveform).toBe(false);
  });
});
