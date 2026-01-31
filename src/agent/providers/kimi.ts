import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatResult, ChatGeneration } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage } from "@langchain/core/messages";

/**
 * Kimi K2.5 Provider for Moonshot AI
 * Custom LangChain implementation since no official package exists
 * Supports video input via base64 encoding
 */

export interface KimiMessage {
  role: "system" | "user" | "assistant";
  content: string | KimiContentPart[];
}

export interface KimiContentPart {
  type: "text" | "video_url";
  text?: string;
  video_url?: {
    url: string;
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
  usage: {
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
    const kimiMessages = this.convertToKimiMessages(messages);
    
    const requestBody: KimiChatCompletionRequest = {
      model: this.model,
      messages: kimiMessages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: false,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Kimi API error: ${response.status} ${response.statusText}\n${errorData}`
      );
    }

    const data = await response.json() as KimiChatCompletionResponse;
    const choice = data.choices[0];
    
    if (!choice) {
      throw new Error("No response from Kimi API");
    }

    // Convert response back to LangChain format
    let content: string;
    if (typeof choice.message.content === "string") {
      content = choice.message.content;
    } else {
      content = choice.message.content
        .map((part: KimiContentPart) => part.text || "")
        .join("");
    }

    const generation: ChatGeneration = {
      text: content,
      message: new AIMessage(content),
    };

    return {
      generations: [generation],
      llmOutput: {
        tokenUsage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
      },
    };
  }

  /**
   * Convert LangChain messages to Kimi format
   * Handles text and video content
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
            } else if (partObj.type === "video_url" && 
                       typeof partObj.video_url === "object" && 
                       partObj.video_url !== null) {
              const videoUrlObj = partObj.video_url as Record<string, string>;
              contentParts.push({
                type: "video_url",
                video_url: { url: videoUrlObj.url },
              });
            }
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
  const fs = await import("fs");
  const buffer = await fs.promises.readFile(filePath);
  return buffer.toString("base64");
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
