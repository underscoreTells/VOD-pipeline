import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/renderer/lib/components/ChapterPreview.svelte", import.meta.url),
  "utf8"
);

describe("chapter preview reverse proxy demand", () => {
  it("only discovers cached reverse media when a chapter mounts", () => {
    expect(source).toContain("void refreshReverseProxy(false, 'background')");
    expect(source).not.toContain("void refreshReverseProxy(true, 'background')");
  });

  it("requests generation when reverse shuttle is first used", () => {
    expect(source).toContain("void refreshReverseProxy(true, 'interactive')");
  });
});
