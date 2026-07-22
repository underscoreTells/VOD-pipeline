import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsApiMocks = vi.hoisted(() => ({
  decryptSettings: vi.fn(),
  encryptSettings: vi.fn(),
}));

vi.mock("../../src/renderer/lib/api/settings.js", () => settingsApiMocks);

describe("settings state", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.resetModules();
    storage.clear();
    Object.values(settingsApiMocks).forEach((mock) => mock.mockReset());

    settingsApiMocks.decryptSettings.mockResolvedValue({
      success: true,
      data: JSON.stringify({}),
    });
    settingsApiMocks.encryptSettings.mockResolvedValue({
      success: true,
      data: "encrypted",
    });

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
        clear: vi.fn(() => {
          storage.clear();
        }),
      },
    });
  });

  it("migrates deprecated naming models when loading saved settings", async () => {
    storage.set("vod-pipeline-settings", JSON.stringify({
      autoChapterNamingModel: "gpt-4o",
      autoClipNamingModel: "gemini-1.5-flash",
      autoThreadNamingModel: "gpt-4o-mini",
      _encryptedKeys: "encrypted",
    }));

    const { loadSettings, settingsState } = await import("../../src/renderer/lib/state/settings.svelte.js");
    await loadSettings();

    expect(settingsState.settings.autoChapterNamingModel).toBe("gpt-5-nano");
    expect(settingsState.settings.autoClipNamingModel).toBe("gemini-3.5-flash-lite");
    expect(settingsState.settings.autoThreadNamingModel).toBe("gpt-5-nano");
  });
});
