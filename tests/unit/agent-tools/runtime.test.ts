import { describe, expect, it } from "vitest";
import { bindAgentToolsForProvider } from "../../../src/agent/tools/binding.js";
import { defineAgentTool } from "../../../src/agent/tools/define-tool.js";
import { validateCanonicalSchema } from "../../../src/agent/tools/runtime.js";
import { canonicalSchema as s } from "../../../src/agent/tools/schema.js";

const runtimeSchema = s.object({
  step: s.required(
    s.discriminatedUnion("type", [
      s.object({
        type: s.required(s.literalString("trim")),
        inPoint: s.required(s.number({ minimum: 0 })),
        outPoint: s.required(s.number({ minimum: 0 })),
      }),
      s.object({
        type: s.required(s.literalString("note")),
        text: s.required(
          s.string({
            minLength: 1,
            maxLength: 80,
          })
        ),
      }),
    ])
  ),
  label: s.optional(
    s.nullable(
      s.string({
        minLength: 1,
        maxLength: 40,
      })
    )
  ),
});

const runtimeTestTool = defineAgentTool({
  name: "runtimeTestTool",
  description: "Validate runtime parsing for canonical tool schemas.",
  schema: runtimeSchema,
  parse: (validated) => {
    const record = validated as {
      step:
        | { type: "trim"; inPoint: number; outPoint: number }
        | { type: "note"; text: string };
      label?: string | null;
    };

    return {
      ...record,
      label: record.label ?? null,
      parsed: true,
    };
  },
  execute: async (input) => JSON.stringify(input),
});

describe("agent tool runtime validation", () => {
  it("validates discriminated unions directly from the canonical schema", () => {
    const validated = validateCanonicalSchema(runtimeSchema, {
      step: {
        type: "trim",
        inPoint: 12,
        outPoint: 20,
      },
    });

    expect(validated).toMatchObject({
      step: {
        type: "trim",
        inPoint: 12,
        outPoint: 20,
      },
    });
  });

  it.each(["openai", "anthropic", "gemini", "openrouter", "kimi"] as const)(
    "round-trips validated tool input through the executable tool for %s",
    async (provider) => {
      const bound = bindAgentToolsForProvider(provider, [runtimeTestTool]);
      const executable = bound.executableToolMap.get("runtimeTestTool");

      expect(executable).toBeDefined();

      const output = await executable!.execute({
        step: {
          type: "note",
          text: "Preserve the reveal wording.",
        },
      });

      expect(JSON.parse(output)).toMatchObject({
        step: {
          type: "note",
          text: "Preserve the reveal wording.",
        },
        label: null,
        parsed: true,
      });
    }
  );

  it("rejects invalid tool input before execution", async () => {
    const bound = bindAgentToolsForProvider("openai", [runtimeTestTool]);
    const executable = bound.executableToolMap.get("runtimeTestTool");

    await expect(
      executable!.execute({
        step: {
          type: "trim",
          inPoint: 30,
          outPoint: "bad",
        },
      })
    ).rejects.toThrow();
  });
});
