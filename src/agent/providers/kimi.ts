import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatResult, ChatGeneration } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage } from "@langchain/core/messages";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

/**
 * Kimi K2.5 Provider for Moonshot AI
 * Custom LangChain implementation since no official package exists
 * Supports video and image input via base64 encoding
 */

export interface KimiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | KimiContentPart[];
  tool_call_id?: string;
  tool_calls?: KimiToolCall[];
}

export interface KimiContentPart {
  type: "text" | "video_url" | "image_url";
  text?: string;
  video_url?: {
    url: string;
  };
  image_url?: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
}

export interface KimiChatCompletionRequest {
  model: string;
  messages: KimiMessage[];
  tools?: KimiToolDefinition[];
  tool_choice?: string | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

export interface KimiChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: KimiMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface KimiToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface KimiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface KimiChatModelParams {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Kimi Chat Model implementation
 * Extends BaseChatModel to integrate with LangChain
 */
export class KimiChatModel extends BaseChatModel {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private temperature: number;
  private maxTokens?: number;

  constructor(fields: KimiChatModelParams) {
    super({});
    this.apiKey = fields.apiKey;
    this.model = fields.model || "kimi-k2.5";
    this.baseUrl = "https://api.moonshot.cn/v1";
    this.temperature = fields.temperature ?? 0.7;
    this.maxTokens = fields.maxTokens;
  }

  _llmType(): string {
    return "kimi";
  }

  _combineLLMOutput(): never {
    return undefined as never;
  }

  /**
   * Main generation method - required by BaseChatModel
   */
  async _generate(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    try {
      const kimiMessages = this.convertToKimiMessages(messages);
      
      const requestBody: KimiChatCompletionRequest = {
        model: this.model,
        messages: kimiMessages,
        tools: this.extractToolDefinitions(_options),
        tool_choice: this.extractToolChoice(_options),
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: false,
      };

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });
      } catch (fetchError) {
        throw new Error(
          `Kimi API fetch failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
        );
      }

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(
          `Kimi API error: ${response.status} ${response.statusText}\n${errorData}`
        );
      }

      let data: KimiChatCompletionResponse;
      try {
        data = await response.json() as KimiChatCompletionResponse;
      } catch (jsonError) {
        throw new Error(
          `Failed to parse Kimi API response: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`
        );
      }

      // Defensive: handle missing choices array
      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        throw new Error("No choices returned from Kimi API");
      }

      const choice = data.choices[0];
      
      // Defensive: handle missing choice or message
      if (!choice || !choice.message) {
        throw new Error("Invalid response structure from Kimi API: missing choice or message");
      }

      // Convert response back to LangChain format
      const content = this.getMessageText(choice.message.content);
      const toolCalls = Array.isArray(choice.message.tool_calls)
        ? choice.message.tool_calls
            .map((toolCall) => this.convertToolCall(toolCall))
            .filter((toolCall): toolCall is NonNullable<typeof toolCall> => toolCall !== null)
        : [];

      // Defensive: handle missing usage data
      const tokenUsage = data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      const aiMessage = new AIMessage({
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      const generation: ChatGeneration = {
        text: content,
        message: aiMessage,
      };

      return {
        generations: [generation],
        llmOutput: {
          tokenUsage: {
            promptTokens: tokenUsage.prompt_tokens ?? 0,
            completionTokens: tokenUsage.completion_tokens ?? 0,
            totalTokens: tokenUsage.total_tokens ?? 0,
          },
        },
      };
    } catch (error) {
      console.error("[KimiChatModel] _generate error:", error);
      throw error;
    }
  }

  /**
   * Convert LangChain messages to Kimi format
   * Handles text, video, and image content
   */
  private convertToKimiMessages(messages: BaseMessage[]): KimiMessage[] {
    return messages.map((msg) => {
      const role = this.mapRole(msg._getType());
      const record = msg as BaseMessage & {
        tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
        tool_call_id?: string;
      };

      if (role === "tool") {
        return {
          role,
          content: this.getMessageText(msg.content),
          tool_call_id: typeof record.tool_call_id === "string" ? record.tool_call_id : undefined,
        };
      }

      if (role === "assistant" && Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
        return {
          role,
          content: this.getMessageText(msg.content),
          tool_calls: record.tool_calls.map((toolCall) => ({
            id: toolCall.id || "",
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.args ?? {}),
            },
          })),
        };
      }
      
      // Handle array content (multimodal)
      if (Array.isArray(msg.content)) {
        const contentParts: KimiContentPart[] = [];
        
        for (const part of msg.content) {
          if (typeof part === "string") {
            contentParts.push({ type: "text", text: part });
          } else if (typeof part === "object" && part !== null) {
            const partObj = part as Record<string, unknown>;
            if (partObj.type === "text" && typeof partObj.text === "string") {
              contentParts.push({ type: "text", text: partObj.text });
            } else if (partObj.type === "image_url" && 
                       typeof partObj.image_url === "object" && 
                       partObj.image_url !== null) {
              const imageUrlObj = partObj.image_url as Record<string, unknown>;
              contentParts.push({
                type: "image_url",
                image_url: { 
                  url: String(imageUrlObj.url || ""),
                  detail: imageUrlObj.detail as "low" | "high" | "auto" | undefined,
                },
              });
            } else if (partObj.type === "video_url" &&
                       typeof partObj.video_url === "object" &&
                       partObj.video_url !== null) {
              const videoUrlObj = partObj.video_url as Record<string, unknown>;
              contentParts.push({
                type: "video_url",
                video_url: {
                  url: String(videoUrlObj.url || ""),
                },
              });
            }
            // Kimi K2.5 supports video_url in multimodal messages for video analysis
          }
        }
        
        return { role, content: contentParts };
      }
      
      // Simple text content
      return { role, content: String(msg.content) };
    });
  }

  /**
   * Map LangChain roles to Kimi roles
   */
  private mapRole(type: string): "system" | "user" | "assistant" | "tool" {
    switch (type) {
      case "system":
        return "system";
      case "human":
        return "user";
      case "ai":
        return "assistant";
      case "tool":
        return "tool";
      default:
        return "user";
    }
  }

  bindTools(tools: unknown[], kwargs?: Record<string, unknown>) {
    return this.withConfig({
      tools: tools.map((tool) =>
        isKimiToolDefinition(tool)
          ? tool
          : (convertToOpenAITool(tool as never) as KimiToolDefinition)
      ),
      ...kwargs,
    });
  }

  private extractToolDefinitions(options: this["ParsedCallOptions"]): KimiToolDefinition[] | undefined {
    const record = options as Record<string, unknown>;
    return Array.isArray(record.tools)
      ? (record.tools as KimiToolDefinition[])
      : undefined;
  }

  private extractToolChoice(
    options: this["ParsedCallOptions"]
  ): string | { type: "function"; function: { name: string } } | undefined {
    const record = options as Record<string, unknown>;
    const toolChoice = record.tool_choice;
    if (
      toolChoice === "auto" ||
      toolChoice === "none" ||
      (typeof toolChoice === "object" && toolChoice !== null)
    ) {
      return toolChoice as string | { type: "function"; function: { name: string } };
    }
    return undefined;
  }

  private convertToolCall(toolCall: KimiToolCall) {
    if (
      !toolCall ||
      typeof toolCall !== "object" ||
      typeof toolCall.id !== "string" ||
      typeof toolCall.function?.name !== "string"
    ) {
      return null;
    }

    try {
      return {
        id: toolCall.id,
        type: "tool_call" as const,
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  private getMessageText(content: string | KimiContentPart[] | unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return String(content ?? "");
    }

    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
      .join("");
  }

  /**
   * Check if this provider supports video input
   */
  supportsVideo(): boolean {
    return true;
  }
}

/**
 * Helper function to read a file and convert to base64
 * Used for sending video files to Kimi
 */
export async function readFileAsBase64(filePath: string): Promise<string> {
  try {
    const fs = await import("fs");
    const buffer = await fs.promises.readFile(filePath);
    return buffer.toString("base64");
  } catch (error) {
    console.error(`[readFileAsBase64] Failed for filePath=${filePath}:`, error);
    throw error;
  }
}

/**
 * Create a video message part for Kimi
 */
export function createKimiVideoPart(base64Video: string, mimeType: string = "video/mp4"): KimiContentPart {
  return {
    type: "video_url",
    video_url: {
      url: `data:${mimeType};base64,${base64Video}`,
    },
  };
}

/**
 * Create an image message part for Kimi
 */
export function createKimiImagePart(base64Image: string, mimeType: string = "image/jpeg", detail?: "low" | "high" | "auto"): KimiContentPart {
  return {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${base64Image}`,
      detail,
    },
  };
}

function isKimiToolDefinition(value: unknown): value is KimiToolDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== "function") {
    return false;
  }

  const toolFunction =
    typeof record.function === "object" && record.function !== null
      ? (record.function as Record<string, unknown>)
      : null;

  return !!toolFunction && typeof toolFunction.name === "string";
}
