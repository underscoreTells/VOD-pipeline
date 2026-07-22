import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAMING_MODEL,
  NAMING_MODEL_OPTIONS,
  getNamingModelProvider,
  normalizeNamingModel,
} from "../../src/shared/llm/naming-models.js";

describe("naming model catalog", () => {
  it("exposes only the supported naming models", () => {
    expect(NAMING_MODEL_OPTIONS.map((option) => option.id)).toEqual([
      "gpt-5-nano",
      "gemini-3.5-flash-lite",
      "kimi-k3",
    ]);
    expect(DEFAULT_NAMING_MODEL).toBe("gpt-5-nano");
  });

  it("maps naming models to providers", () => {
    expect(getNamingModelProvider("gpt-5-nano")).toBe("openai");
    expect(getNamingModelProvider("gemini-3.5-flash-lite")).toBe("gemini");
    expect(getNamingModelProvider("kimi-k3")).toBe("kimi");
  });

  it("normalizes deprecated naming model values", () => {
    expect(normalizeNamingModel("gpt-4o-mini")).toBe("gpt-5-nano");
    expect(normalizeNamingModel("gpt-4o")).toBe("gpt-5-nano");
    expect(normalizeNamingModel("gemini-1.5-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeNamingModel("gemini-3.0-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeNamingModel("gemini-3-flash")).toBe("gemini-3.5-flash-lite");
    expect(normalizeNamingModel("kimi-k2.5")).toBe("kimi-k3");
    expect(normalizeNamingModel("unknown-model")).toBe("gpt-5-nano");
  });
});
