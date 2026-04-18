export {
  agentChat,
  applyAgentActions,
  createAgentConversation,
  deleteAgentConversation,
  getAgentConversationMessages,
  listAgentConversations,
  onAgentError,
  onAgentStream,
} from '../state/electron.svelte.js';

export function getSuggestions(params: { chapterId: string; conversationId: number }) {
  return window.electronAPI.agent.getSuggestions(params);
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

export function applyAllSuggestions(params: { chapterId: string; conversationId: number }) {
  return window.electronAPI.agent.applyAllSuggestions(params);
}

export function rejectSuggestion(suggestionId: number) {
  return window.electronAPI.agent.rejectSuggestion(suggestionId);
}
