import { describe, expect, it } from "vitest";
import { formatChapterRange } from "../../src/renderer/lib/components/chapter-panel-helpers.js";

describe("chapter panel helpers", () => {
  it("formats an absolute chapter range label", () => {
    expect(
      formatChapterRange({
        start_time: 798.91,
        end_time: 1948.36,
      })
    ).toBe("[13:18 - 32:28]");
  });
});
