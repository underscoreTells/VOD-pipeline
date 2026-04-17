export {
  agentChat,
  applyAgentActions,
  createAgentConversation,
  deleteAgentConversation,
  getAgentConversationMessages,
  listAgentConversations,
} from '../state/electron.svelte.js';

export function getSuggestions(chapterId: string) {
  return window.electronAPI.agent.getSuggestions(chapterId);
}

export function previewSuggestion(suggestionId: number) {
  return window.electronAPI.agent.previewSuggestion(suggestionId);
}

export function cancelSuggestionPreview(suggestionId: number) {
  return window.electronAPI.agent.cancelSuggestionPreview(suggestionId);
}

export function applySuggestion(suggestionId: number) {
  return window.electronAPI.agent.applySuggestion(suggestionId);
}

export function applyAllSuggestions(chapterId: string) {
  return window.electronAPI.agent.applyAllSuggestions(chapterId);
}

export function rejectSuggestion(suggestionId: number) {
  return window.electronAPI.agent.rejectSuggestion(suggestionId);
}
