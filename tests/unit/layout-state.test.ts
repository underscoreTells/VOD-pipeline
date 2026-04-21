import { beforeEach, describe, expect, it, vi } from "vitest";

describe("layout state persistence", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.resetModules();
    storage.clear();

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

  it("loads the persisted suggestions tray height from layout storage", async () => {
    storage.set("vod-pipeline-layout", JSON.stringify({
      suggestionsTrayMaxHeight: 312,
    }));

    const { layoutState, loadLayout } = await import("../../src/renderer/lib/state/layout.svelte.js");
    loadLayout();

    expect(layoutState.suggestionsTrayMaxHeight).toBe(312);
  });

  it("writes the suggestions tray height back during layout persistence", async () => {
    const {
      persistLayout,
      setSuggestionsTrayMaxHeight,
    } = await import("../../src/renderer/lib/state/layout.svelte.js");

    setSuggestionsTrayMaxHeight(388);
    persistLayout();

    expect(JSON.parse(storage.get("vod-pipeline-layout") ?? "{}")).toMatchObject({
      suggestionsTrayMaxHeight: 388,
    });
  });
});
