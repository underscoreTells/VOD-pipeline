import { describe, expect, it } from "vitest";
import { getExternalHttpUrl } from "../../src/electron/bootstrap/window-navigation.js";

describe("window navigation policy", () => {
  it("allows http and https links", () => {
    expect(getExternalHttpUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(getExternalHttpUrl("http://example.com/docs")).toBe("http://example.com/docs");
  });

  it("denies unsupported schemes and invalid urls", () => {
    expect(getExternalHttpUrl("mailto:test@example.com")).toBeNull();
    expect(getExternalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(getExternalHttpUrl("not a url")).toBeNull();
  });
});
