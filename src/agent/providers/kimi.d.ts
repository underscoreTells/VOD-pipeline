import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
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
export declare class KimiChatModel extends BaseChatModel {
    private apiKey;
    private model;
    private baseUrl;
    private temperature;
    private maxTokens?;
    constructor(fields: KimiChatModelParams);
    _llmType(): string;
    _combineLLMOutput(): never;
    /**
     * Main generation method - required by BaseChatModel
     */
    _generate(messages: BaseMessage[], _options: this["ParsedCallOptions"], _runManager?: CallbackManagerForLLMRun): Promise<ChatResult>;
    /**
     * Convert LangChain messages to Kimi format
     * Handles text, video, and image content
     */
    private convertToKimiMessages;
    /**
     * Map LangChain roles to Kimi roles
     */
    private mapRole;
    /**
     * Check if this provider supports video input
     */
    supportsVideo(): boolean;
}
/**
 * Helper function to read a file and convert to base64
 * Used for sending video files to Kimi
 */
export declare function readFileAsBase64(filePath: string): Promise<string>;
/**
 * Create a video message part for Kimi
 */
export declare function createKimiVideoPart(base64Video: string, mimeType?: string): KimiContentPart;
/**
 * Create an image message part for Kimi
 */
export declare function createKimiImagePart(base64Image: string, mimeType?: string, detail?: "low" | "high" | "auto"): KimiContentPart;
