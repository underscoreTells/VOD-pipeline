import { describe, expect, it } from "vitest";
import {
  shouldSyncAgentChapterContext,
  toAgentChapterId,
} from "../../src/renderer/lib/components/project-detail-helpers.js";

describe("project detail agent chapter sync helpers", () => {
  it("normalizes numeric chapter ids to string ids", () => {
    expect(toAgentChapterId(42)).toBe("42");
    expect(toAgentChapterId(null)).toBeNull();
    expect(toAgentChapterId(undefined)).toBeNull();
  });

  it("only syncs when the primitive chapter id changes", () => {
    expect(shouldSyncAgentChapterContext(null, "42")).toBe(true);
    expect(shouldSyncAgentChapterContext("42", "42")).toBe(false);
    expect(shouldSyncAgentChapterContext("42", "43")).toBe(true);
  });
});
