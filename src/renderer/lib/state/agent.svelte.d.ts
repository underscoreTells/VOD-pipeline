import type { Suggestion } from "../../../shared/types/database";
export type LLMProviderType = "gemini" | "openai" | "anthropic" | "openrouter" | "kimi";
export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    id: string;
    timestamp: Date;
}
export interface AgentState {
    messages: ChatMessage[];
    suggestions: Suggestion[];
    selectedProvider: LLMProviderType;
    isStreaming: boolean;
    currentProjectId: string | null;
    currentChapterId: string | null;
    proxyPath: string | null;
    error: string | null;
}
export declare const agentState: AgentState;
export declare function setProjectContext(projectId: string | null): void;
export declare function sendChatMessage(message: string): Promise<void>;
export declare function setProvider(provider: LLMProviderType): void;
export declare function setChapterContext(chapterId: string | null, proxyPath: string | null): void;
export declare function loadSuggestions(chapterId: string): Promise<void>;
export declare function applySuggestion(suggestionId: number): Promise<{
    success: boolean;
    clip: {
        id: number;
    } | undefined;
    error?: undefined;
} | {
    success: boolean;
    error: string | undefined;
    clip?: undefined;
}>;
export declare function rejectSuggestion(suggestionId: number): Promise<boolean>;
export declare function clearMessages(): void;
export declare function clearSuggestions(): void;
