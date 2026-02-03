import { BaseChatModel } from "@langchain/core/language_models/chat_models";
export type LLMProviderType = "openai" | "gemini" | "anthropic" | "openrouter" | "kimi";
export declare const VIDEO_CAPABLE_PROVIDERS: LLMProviderType[];
export interface LLMConfig {
    provider: LLMProviderType;
    apiKey: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    baseURL?: string;
}
export declare function createLLM(config: LLMConfig): BaseChatModel;
