import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
  registerProjectHandlers: vi.fn(),
  registerAssetHandlers: vi.fn(),
  registerChapterHandlers: vi.fn(),
  registerTranscriptionHandlers: vi.fn(),
  registerAgentHandlers: vi.fn(),
  registerClipHandlers: vi.fn(),
  registerTimelineHandlers: vi.fn(),
  registerWaveformHandlers: vi.fn(),
  registerExportHandlers: vi.fn(),
  registerDialogHandlers: vi.fn(),
  registerSuggestionHandlers: vi.fn(),
  registerSettingsHandlers: vi.fn(),
}));

vi.mock("../../src/electron/ipc/handlers/projects.js", () => ({
  PROJECT_HANDLER_CHANNELS: ["project:get", "project:list"],
  registerProjectHandlers: registrations.registerProjectHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/assets.js", () => ({
  ASSET_HANDLER_CHANNELS: ["asset:create"],
  registerAssetHandlers: registrations.registerAssetHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/chapters.js", () => ({
  CHAPTER_HANDLER_CHANNELS: ["chapter:create"],
  registerChapterHandlers: registrations.registerChapterHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/transcription.js", () => ({
  TRANSCRIPTION_HANDLER_CHANNELS: ["transcription:status"],
  registerTranscriptionHandlers: registrations.registerTranscriptionHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/agent.js", () => ({
  AGENT_HANDLER_CHANNELS: ["agent:chat"],
  registerAgentHandlers: registrations.registerAgentHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/clips.js", () => ({
  CLIP_HANDLER_CHANNELS: ["clip:create"],
  registerClipHandlers: registrations.registerClipHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/timeline.js", () => ({
  TIMELINE_HANDLER_CHANNELS: ["timeline:save"],
  registerTimelineHandlers: registrations.registerTimelineHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/waveforms.js", () => ({
  WAVEFORM_HANDLER_CHANNELS: ["waveform:get"],
  registerWaveformHandlers: registrations.registerWaveformHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/exports.js", () => ({
  EXPORT_HANDLER_CHANNELS: ["export:fcpxml"],
  registerExportHandlers: registrations.registerExportHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/dialog.js", () => ({
  DIALOG_HANDLER_CHANNELS: ["dialog:showSaveDialog"],
  registerDialogHandlers: registrations.registerDialogHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/suggestions.js", () => ({
  SUGGESTION_HANDLER_CHANNELS: ["suggestion:list"],
  registerSuggestionHandlers: registrations.registerSuggestionHandlers,
}));

vi.mock("../../src/electron/ipc/handlers/settings.js", () => ({
  SETTINGS_HANDLER_CHANNELS: ["settings:get"],
  registerSettingsHandlers: registrations.registerSettingsHandlers,
}));

describe("ipc register", () => {
  beforeEach(() => {
    Object.values(registrations).forEach((mock) => mock.mockReset());
  });

  it("registers each modular handler set exactly once", async () => {
    const { REGISTERED_IPC_CHANNELS, registerIpcHandlers } = await import("../../src/electron/ipc/register.js");

    registerIpcHandlers();

    expect(registrations.registerProjectHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerAssetHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerChapterHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerTranscriptionHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerAgentHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerClipHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerTimelineHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerWaveformHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerExportHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerDialogHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerSuggestionHandlers).toHaveBeenCalledTimes(1);
    expect(registrations.registerSettingsHandlers).toHaveBeenCalledTimes(1);

    expect(REGISTERED_IPC_CHANNELS).toEqual([
      "project:get",
      "project:list",
      "asset:create",
      "chapter:create",
      "transcription:status",
      "agent:chat",
      "clip:create",
      "timeline:save",
      "waveform:get",
      "export:fcpxml",
      "dialog:showSaveDialog",
      "suggestion:list",
      "settings:get",
    ]);
    expect(new Set(REGISTERED_IPC_CHANNELS).size).toBe(REGISTERED_IPC_CHANNELS.length);
  });

  it("does not reference the legacy registration path", () => {
    const source = readFileSync(new URL("../../src/electron/ipc/register.ts", import.meta.url), "utf8");

    expect(source).not.toContain("registerLegacyIpcHandlers");
    expect(source).not.toContain("./handlers.js");
  });
});
