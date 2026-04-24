import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { createConversationTools } from "../../../src/agent/conversation/tools.js";
import type { ConversationTurnInput } from "../../../src/agent/conversation/types.js";
import { bindAgentToolsForProvider } from "../../../src/agent/tools/binding.js";
import { defineAgentTool } from "../../../src/agent/tools/define-tool.js";
import { canonicalSchema as s } from "../../../src/agent/tools/schema.js";

const TEST_MODES = ["alpha", "beta"] as const;

const schemaStrategyTestTool = defineAgentTool({
  name: "schemaStrategyTestTool",
  description: "Validate provider-native tool schema compilation.",
  schema: s.object(
    {
      items: s.required(
        s.array(
          s.discriminatedUnion("type", [
            s.object({
              type: s.required(s.literalString(TEST_MODES[0])),
              count: s.required(s.integer({ exclusiveMinimum: 0 })),
            }),
            s.object({
              type: s.required(s.literalString(TEST_MODES[1])),
              note: s.optional(
                s.nullable(
                  s.string({
                    minLength: 1,
                    maxLength: 40,
                  })
                )
              ),
            }),
          ]),
          { minItems: 1, maxItems: 3 }
        )
      ),
    },
    { description: "A provider strategy compilation fixture." }
  ),
  examples: [{ items: [{ type: TEST_MODES[0], count: 1 }] }],
  metadata: { anthropicStrict: true },
  execute: async (input) => JSON.stringify(input),
});

function createConversationInput(): ConversationTurnInput {
  return {
    messages: [new HumanMessage("Please provide new clips for this chapter.")],
    selectedProvider: "openai",
    selectedClipIds: [],
    playheadTime: 18,
    context: {
      chapter: {
        id: "42",
        title: "Boss fight",
        startTime: 0,
        endTime: 300,
      },
      chapterAssetIds: [7],
      chapterClips: [],
      transcript: "Setup in the first minute, payoff near the end.",
      detailedTranscripts: [],
      proxyPath: "/tmp/chapter-proxy.mp4",
      suggestionSummary: "- none",
    },
  };
}

describe("provider-aware tool schema strategies", () => {
  it.each(["openai", "openrouter", "kimi"] as const)(
    "emits OpenAI-style function tools for %s",
    (provider) => {
      const bound = bindAgentToolsForProvider(provider, [schemaStrategyTestTool]);
      expect(bound.bindPayload).toHaveLength(1);
      expect(bound.bindPayload[0]).toMatchObject({
        type: "function",
        function: {
          name: "schemaStrategyTestTool",
        },
      });
    }
  );

  it("emits native Anthropic tools with input_schema and examples", () => {
    const bound = bindAgentToolsForProvider("anthropic", [schemaStrategyTestTool]);
    expect(bound.bindPayload[0]).toMatchObject({
      name: "schemaStrategyTestTool",
      input_schema: expect.any(Object),
      input_examples: [{ items: [{ type: TEST_MODES[0], count: 1 }] }],
      strict: true,
    });
  });

  it("emits native Gemini function declarations without rejected keywords", () => {
    const bound = bindAgentToolsForProvider("gemini", [schemaStrategyTestTool]);
    const serialized = JSON.stringify(bound.bindPayload);

    expect(bound.bindPayload[0]).toMatchObject({
      functionDeclarations: [
        expect.objectContaining({
          name: "schemaStrategyTestTool",
          parameters: expect.any(Object),
        }),
      ],
    });
    expect(serialized).toContain("\"anyOf\"");
    expect(serialized).toContain("\"minimum\":1");
    expect(serialized).not.toContain("\"const\"");
    expect(serialized).not.toContain("\"exclusiveMinimum\"");
    expect(serialized).not.toContain("\"oneOf\"");
  });

  it.each(["openai", "anthropic", "gemini", "openrouter", "kimi"] as const)(
    "compiles conversation proposal and finalizer tools for %s",
    (provider) => {
      const accumulator = {
        suggestionDrafts: [],
        timelineActions: [],
        transcriptDetailRequests: [],
      };
      const toolDefinitions = createConversationTools(
        { ...createConversationInput(), selectedProvider: provider },
        undefined,
        accumulator,
        {}
      );

      const bound = bindAgentToolsForProvider(provider, toolDefinitions);
      const compiledDraftTool = bound.compiledTools.find(
        (tool) => tool.name === "draftRoughCutProposals"
      );
      const compiledFinalizeTool = bound.compiledTools.find(
        (tool) => tool.name === "finalizeConversationTurn"
      );

      expect(compiledDraftTool).toBeDefined();
      expect(compiledFinalizeTool).toBeDefined();
    }
  );

  it("always exposes proposal tools regardless of the latest user wording", () => {
    const accumulator = {
      suggestionDrafts: [],
      timelineActions: [],
      transcriptDetailRequests: [],
    };

    const toolDefinitions = createConversationTools(
      {
        ...createConversationInput(),
        messages: [new HumanMessage("What is the story arc of this chapter?")],
      },
      undefined,
      accumulator,
      {}
    );

    expect(toolDefinitions.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["draftRoughCutProposals", "finalizeConversationTurn"])
    );
  });
});
