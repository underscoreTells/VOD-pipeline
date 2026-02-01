import { v4 as uuidv4 } from "uuid";
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

// Create agent state
export const agentState = $state<AgentState>({
  messages: [],
  suggestions: [],
  selectedProvider: "gemini",
  isStreaming: false,
  currentProjectId: null,
  currentChapterId: null,
  proxyPath: null,
  error: null,
});

export function setProjectContext(projectId: string | null) {
  agentState.currentProjectId = projectId;
}

export async function sendChatMessage(message: string) {
  if (!message.trim()) return;

  // Validate that we have a project context
  if (!agentState.currentProjectId) {
    console.error("[Agent] Cannot send message: no project selected");
    agentState.error = "No project selected. Please open a project first.";
    const errorMessage: ChatMessage = {
      role: "assistant",
      content: "Error: No project selected. Please open a project first.",
      id: uuidv4(),
      timestamp: new Date(),
    };
    agentState.messages.push(errorMessage);
    return;
  }

  const userMessage: ChatMessage = {
    role: "user",
    content: message,
    id: uuidv4(),
    timestamp: new Date(),
  };

  agentState.messages.push(userMessage);
  agentState.isStreaming = true;
  agentState.error = null;

  try {
    const response = await window.electronAPI.agent.chat({
      projectId: agentState.currentProjectId,
      message,
      provider: agentState.selectedProvider,
      chapterId: agentState.currentChapterId || undefined,
    });

    if (response.success && response.data) {
      const result = response.data as any;

      if (result.suggestions) {
        // Add suggestions to state
        agentState.suggestions.push(...result.suggestions);
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.message || result.content || "Analysis complete",
        id: uuidv4(),
        timestamp: new Date(),
      };

      agentState.messages.push(assistantMessage);
    } else {
      agentState.error = response.error || "Unknown error";
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `Error: ${agentState.error}`,
        id: uuidv4(),
        timestamp: new Date(),
      };
      agentState.messages.push(errorMessage);
    }
  } catch (error) {
    agentState.error = (error as Error).message;
    const errorMessage: ChatMessage = {
      role: "assistant",
      content: `Error: ${agentState.error}`,
      id: uuidv4(),
      timestamp: new Date(),
    };
    agentState.messages.push(errorMessage);
  } finally {
    agentState.isStreaming = false;
  }
}

export function setProvider(provider: LLMProviderType) {
  agentState.selectedProvider = provider;
}

export function setChapterContext(chapterId: string | null, proxyPath: string | null) {
  agentState.currentChapterId = chapterId;
  agentState.proxyPath = proxyPath;
}

export async function loadSuggestions(chapterId: string) {
  try {
    const response = await window.electronAPI.agent.getSuggestions(chapterId);
    if (response.success && response.data) {
      agentState.suggestions = response.data as Suggestion[];
    }
  } catch (error) {
    console.error("Failed to load suggestions:", error);
  }
}

export async function applySuggestion(suggestionId: number) {
  try {
    const response = await window.electronAPI.agent.applySuggestion(suggestionId);
    if (response.success) {
      const result = response.data as { applied: boolean; clip?: { id: number } };
      
      // Update local state
      const suggestion = agentState.suggestions.find((s) => s.id === suggestionId);
      if (suggestion) {
        suggestion.status = "applied";
        if (result.clip) {
          suggestion.clip_id = result.clip.id;
        }
      }
      
      // Return the created clip info for timeline refresh
      return { success: true, clip: result.clip };
    }
    return { success: false, error: response.error };
  } catch (error) {
    console.error("Failed to apply suggestion:", error);
    return { success: false, error: (error as Error).message };
  }
}

export async function rejectSuggestion(suggestionId: number) {
  try {
    const response = await window.electronAPI.agent.rejectSuggestion(suggestionId);
    if (response.success) {
      // Update local state
      const suggestion = agentState.suggestions.find((s) => s.id === suggestionId);
      if (suggestion) {
        suggestion.status = "rejected";
      }
    }
    return response.success;
  } catch (error) {
    console.error("Failed to reject suggestion:", error);
    return false;
  }
}

export function clearMessages() {
  agentState.messages = [];
}

export function clearSuggestions() {
  agentState.suggestions = [];
}
