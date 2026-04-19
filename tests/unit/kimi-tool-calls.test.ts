import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { KimiChatModel } from "../../src/agent/providers/kimi.js";
import type { KimiToolDefinition } from "../../src/agent/providers/kimi.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(responseBody: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  } as Response);
}

describe("Kimi tool calling", () => {
  it("includes bound tools in the request and parses tool_calls in the response", async () => {
    const fetchMock = mockFetch({
      id: "chatcmpl_1",
      object: "chat.completion",
      created: Date.now(),
      model: "kimi-k2.5",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "draftRoughCutProposals",
                  arguments: '{"proposals":[]}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      },
    });

    const draftRoughCutProposalsTool = tool(async ({ proposals }) => JSON.stringify(proposals), {
      name: "draftRoughCutProposals",
      description: "Draft rough-cut proposals",
      schema: z.object({
        proposals: z.array(z.object({ in_point: z.number(), out_point: z.number() })).default([]),
      }),
    });

    const model = new KimiChatModel({ apiKey: "test-key", model: "kimi-k2.5" }).bindTools([
      draftRoughCutProposalsTool,
    ]);

    const response = await model.invoke([new HumanMessage("What should we cut?")]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.tools).toHaveLength(1);
    expect(request.tools[0]?.function?.name).toBe("draftRoughCutProposals");
    expect(response.tool_calls).toHaveLength(1);
    expect(response.tool_calls?.[0]).toMatchObject({
      id: "call_1",
      name: "draftRoughCutProposals",
      args: { proposals: [] },
    });
  });

  it("preserves precompiled OpenAI-style tool definitions without reconversion", async () => {
    const fetchMock = mockFetch({
      id: "chatcmpl_native_tool",
      object: "chat.completion",
      created: Date.now(),
      model: "kimi-k2.5",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "Done",
          },
        },
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 2,
        total_tokens: 10,
      },
    });

    const toolDefinition: KimiToolDefinition = {
      type: "function",
      function: {
        name: "draftRoughCutProposals",
        description: "Draft rough-cut proposals",
        parameters: {
          type: "object",
          properties: {
            proposals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["range_suggestion"] },
                },
                required: ["type"],
              },
            },
          },
          required: ["proposals"],
        },
      },
    };

    const model = new KimiChatModel({ apiKey: "test-key", model: "kimi-k2.5" }).bindTools([
      toolDefinition,
    ]);

    await model.invoke([new HumanMessage("What should we cut?")]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.tools).toEqual([toolDefinition]);
  });

  it("round-trips assistant tool calls and tool messages in request history", async () => {
    const fetchMock = mockFetch({
      id: "chatcmpl_2",
      object: "chat.completion",
      created: Date.now(),
      model: "kimi-k2.5",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "Done",
          },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 2,
        total_tokens: 14,
      },
    });

    const model = new KimiChatModel({ apiKey: "test-key", model: "kimi-k2.5" });

    await model.invoke([
      new HumanMessage("Start"),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_7",
            type: "tool_call",
            name: "draftRoughCutProposals",
            args: { proposals: [{ in_point: 12, out_point: 24 }] },
          },
        ],
      }),
      new ToolMessage({
        content: '{"acceptedCount":1}',
        tool_call_id: "call_7",
      }),
    ]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_7",
          type: "function",
          function: {
            name: "draftRoughCutProposals",
            arguments: '{"proposals":[{"in_point":12,"out_point":24}]}',
          },
        },
      ],
    });
    expect(request.messages[2]).toMatchObject({
      role: "tool",
      tool_call_id: "call_7",
      content: '{"acceptedCount":1}',
    });
  });

  it("preserves multimodal video content in request messages", async () => {
    const fetchMock = mockFetch({
      id: "chatcmpl_3",
      object: "chat.completion",
      created: Date.now(),
      model: "kimi-k2.5",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "Video inspected",
          },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 3,
        total_tokens: 23,
      },
    });

    const model = new KimiChatModel({ apiKey: "test-key", model: "kimi-k2.5" });

    await model.invoke([
      new HumanMessage({
        content: [
          { type: "text", text: "Inspect the reveal." },
          { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } },
        ] as any,
      }),
    ]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.messages[0]?.content).toEqual([
      { type: "text", text: "Inspect the reveal." },
      {
        type: "video_url",
        video_url: { url: "data:video/mp4;base64,AAAA" },
      },
    ]);
  });
});
