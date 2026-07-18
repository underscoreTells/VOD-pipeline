import { beforeEach, describe, expect, it, vi } from "vitest";
import { showSaveDialog, getPathForFile } from "../../src/renderer/lib/api/system.js";
import { getTranscriptionStatus } from "../../src/renderer/lib/api/transcription.js";
import {
  clearVodCutDraft,
  commitVodCut,
  loadVodCutDraft,
  saveVodCutDraft,
} from "../../src/renderer/lib/api/vod-cuts.js";

describe("renderer API clients", () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      window: {
        electronAPI: {
          transcription: {
            getStatus: vi.fn().mockResolvedValue({ success: true, data: { available: true } }),
          },
          dialog: {
            showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: "/tmp/edit.fcpxml" }),
          },
          webUtils: {
            getPathForFile: vi.fn().mockReturnValue("/tmp/media.mp4"),
          },
          vodCuts: {
            saveDraft: vi.fn().mockResolvedValue({ success: true, data: { project_id: 7, asset_id: 9, ranges: [], updated_at: "t" } }),
            loadDraft: vi.fn().mockResolvedValue({ success: true, data: null }),
            clearDraft: vi.fn().mockResolvedValue({ success: true, data: null }),
            commit: vi.fn().mockResolvedValue({ success: true, data: [{ id: 101 }] }),
          },
        },
      },
    });
  });

  it("routes transcription calls through the shared client", async () => {
    const response = await getTranscriptionStatus(true);

    expect(window.electronAPI.transcription.getStatus).toHaveBeenCalledWith({ autoSetup: true });
    expect(response).toEqual({ success: true, data: { available: true } });
  });

  it("routes dialog and web utils calls through the shared client", async () => {
    const dialogResult = await showSaveDialog({
      defaultPath: "/tmp/edit.fcpxml",
      filters: [{ name: "FCPXML", extensions: ["fcpxml"] }],
    });
    const resolvedPath = getPathForFile({ path: "/tmp/media.mp4" });

    expect(window.electronAPI.dialog.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: "/tmp/edit.fcpxml",
      filters: [{ name: "FCPXML", extensions: ["fcpxml"] }],
    });
    expect(window.electronAPI.webUtils.getPathForFile).toHaveBeenCalledWith({ path: "/tmp/media.mp4" });
    expect(dialogResult).toEqual({ canceled: false, filePath: "/tmp/edit.fcpxml" });
    expect(resolvedPath).toBe("/tmp/media.mp4");
  });

  it("routes vod-cut save draft calls through the shared client with exact arguments", async () => {
    const input = {
      projectId: 7,
      assetId: 9,
      ranges: [
        { id: "a", title: "Intro", start_time: 0, end_time: 120 },
        { id: "b", title: "Mid", start_time: 120, end_time: 300 },
      ],
    };

    const result = await saveVodCutDraft(input);

    expect(window.electronAPI.vodCuts.saveDraft).toHaveBeenCalledWith(input);
    expect(window.electronAPI.vodCuts.saveDraft).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: { project_id: 7, asset_id: 9, ranges: [], updated_at: "t" } });
  });

  it("routes vod-cut load draft calls through the shared client with exact arguments", async () => {
    const result = await loadVodCutDraft(7, 9);

    expect(window.electronAPI.vodCuts.loadDraft).toHaveBeenCalledWith(7, 9);
    expect(window.electronAPI.vodCuts.loadDraft).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: null });
  });

  it("routes vod-cut clear draft calls through the shared client with exact arguments", async () => {
    const result = await clearVodCutDraft(7, 9);

    expect(window.electronAPI.vodCuts.clearDraft).toHaveBeenCalledWith(7, 9);
    expect(window.electronAPI.vodCuts.clearDraft).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: null });
  });

  it("routes vod-cut commit calls through the shared client with exact arguments", async () => {
    const input = {
      projectId: 7,
      assetId: 9,
      ranges: [
        { title: "Intro", startTime: 0, endTime: 120 },
        { title: "Mid", startTime: 120, endTime: 300 },
      ],
      prewarmProxy: true,
      proxyOptions: { encodingMode: "gpu", quality: "fast" },
    };

    const result = await commitVodCut(input);

    expect(window.electronAPI.vodCuts.commit).toHaveBeenCalledWith(input);
    expect(window.electronAPI.vodCuts.commit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: [{ id: 101 }] });
  });
});
