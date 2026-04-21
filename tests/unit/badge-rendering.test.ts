import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import BadgeUsage from "../support/BadgeUsage.svelte";

describe("badge rendering", () => {
  it("renders snippet children and forwarded classes", () => {
    const { body } = render(BadgeUsage);

    expect(body).toContain("Video");
    expect(body).toContain("Setup");
    expect(body).toContain("custom-badge");
    expect(body).toContain("inline-flex items-center");
    expect(body).toContain("rounded-[6px]");
  });
});
