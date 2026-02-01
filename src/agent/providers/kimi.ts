import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatResult, ChatGeneration } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage } from "@langchain/core/messages";

/**
 * Kimi K2.5 Provider for Moonshot AI
 * Custom LangChain implementation since no official package exists
 * Supports video and image input via base64 encoding
 */

export interface KimiMessage {
  role: "system" | "user" | "assistant";
  content: string | KimiContentPart[];
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
      let content: string;
      if (typeof choice.message.content === "string") {
        content = choice.message.content;
      } else if (Array.isArray(choice.message.content)) {
        content = choice.message.content
          .map((part: KimiContentPart) => part.text || "")
          .join("");
      } else {
        content = "";
      }

      // Defensive: handle missing usage data
      const tokenUsage = data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      const generation: ChatGeneration = {
        text: content,
        message: new AIMessage(content),
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
  private mapRole(type: string): "system" | "user" | "assistant" {
    switch (type) {
      case "system":
        return "system";
      case "human":
        return "user";
      case "ai":
        return "assistant";
      default:
        return "user";
    }
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
