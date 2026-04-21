import { beforeEach, describe, expect, it, vi } from "vitest";
import { showSaveDialog, getPathForFile } from "../../src/renderer/lib/api/system.js";
import { getTranscriptionStatus } from "../../src/renderer/lib/api/transcription.js";

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
});
