import type {
  AgentApplyActionsParams,
  AgentApplyActionsResult,
  AgentBranchMessageParams,
  AgentChatParams,
  AgentChatResult,
  AgentCancelTurnResult,
  AgentGroundingStatusParams,
  AgentGroundingStatusResult,
  AgentConversationCreateParams,
  AgentConversationCreateResult,
  AgentConversationListParams,
  AgentConversationListResult,
  AgentConversationMessagesResult,
  AgentEditMessageParams,
  AgentRerollMessageParams,
  ApplyAllSuggestionsResult,
  SuggestionListParams,
  SuggestionListResult,
  SuggestionMutationResult,
  SuggestionBatchParams,
  SuggestionBatchRevertParams,
  SuggestionBatchMutationResult,
} from '../../../shared/contracts/electron-api.js';
import type { AgentStreamEvent } from '../../../shared/types/agent-ipc.js';
import { getElectronApi } from './client.js';

export type {
  AgentApplyActionsParams,
  AgentApplyActionsResult,
  AgentBranchMessageParams,
  AgentChatParams,
  AgentChatResult,
  AgentCancelTurnResult,
  AgentGroundingStatusParams,
  AgentGroundingStatusResult,
  AgentConversationCreateParams,
  AgentConversationCreateResult,
  AgentConversationListParams,
  AgentConversationListResult,
  AgentConversationMessagesResult,
  AgentEditMessageParams,
  AgentRerollMessageParams,
  ApplyAllSuggestionsResult,
  SuggestionListParams,
  SuggestionListResult,
  SuggestionMutationResult,
  SuggestionBatchParams,
  SuggestionBatchRevertParams,
  SuggestionBatchMutationResult,
} from '../../../shared/contracts/electron-api.js';

export async function agentChat(params: AgentChatParams): Promise<AgentChatResult> {
  return await getElectronApi().agent.chat(params);
}

export async function cancelAgentTurn(
  clientRequestId: string
): Promise<AgentCancelTurnResult> {
  return await getElectronApi().agent.cancelTurn(clientRequestId);
}

export async function getAgentGroundingStatus(
  params: AgentGroundingStatusParams
): Promise<AgentGroundingStatusResult> {
  return await getElectronApi().agent.getGroundingStatus(params);
}

export async function rerollAgentMessage(
  params: AgentRerollMessageParams
): Promise<AgentChatResult> {
  return await getElectronApi().agent.rerollMessage(params);
}

export async function editAgentMessage(
  params: AgentEditMessageParams
): Promise<AgentChatResult> {
  return await getElectronApi().agent.editMessage(params);
}

export async function branchAgentMessage(
  params: AgentBranchMessageParams
): Promise<AgentConversationCreateResult> {
  return await getElectronApi().agent.branchMessage(params);
}

export async function createAgentConversation(
  params: AgentConversationCreateParams
): Promise<AgentConversationCreateResult> {
  return await getElectronApi().agent.createConversation(params);
}

export async function listAgentConversations(
  params: AgentConversationListParams
): Promise<AgentConversationListResult> {
  return await getElectronApi().agent.listConversations(params);
}

export async function getAgentConversationMessages(
  conversationId: number
): Promise<AgentConversationMessagesResult> {
  return await getElectronApi().agent.getConversationMessages(conversationId);
}

export async function deleteAgentConversation(
  conversationId: number
): Promise<{ success: boolean; error?: string }> {
  return await getElectronApi().agent.deleteConversation(conversationId);
}

export async function applyAgentActions(
  params: AgentApplyActionsParams
): Promise<AgentApplyActionsResult> {
  return await getElectronApi().agent.applyActions(params);
}

export function onAgentStream(callback: (message: AgentStreamEvent) => void): () => void {
  return getElectronApi().agent.onStream(callback);
}

export function onAgentError(callback: (payload: { error: string }) => void): () => void {
  return getElectronApi().agent.onError(callback);
}

export async function getSuggestions(
  params: SuggestionListParams
): Promise<SuggestionListResult> {
  return await getElectronApi().agent.getSuggestions(params);
}

export async function applySuggestion(
  suggestionId: number
): Promise<SuggestionMutationResult> {
  return await getElectronApi().agent.applySuggestion(suggestionId);
}

export async function applyAllSuggestions(
  params: SuggestionListParams
): Promise<ApplyAllSuggestionsResult> {
  return await getElectronApi().agent.applyAllSuggestions(params);
}

export async function rejectSuggestion(
  suggestionId: number
): Promise<SuggestionMutationResult> {
  return await getElectronApi().agent.rejectSuggestion(suggestionId);
}

export async function applySuggestionBatch(
  params: SuggestionBatchParams
): Promise<SuggestionBatchMutationResult> {
  return await getElectronApi().agent.applySuggestionBatch(params);
}

export async function rejectSuggestionBatch(
  params: SuggestionBatchParams
): Promise<SuggestionBatchMutationResult> {
  return await getElectronApi().agent.rejectSuggestionBatch(params);
}

export async function restoreSuggestionBatch(
  params: SuggestionBatchParams
): Promise<SuggestionBatchMutationResult> {
  return await getElectronApi().agent.restoreSuggestionBatch(params);
}

export async function revertSuggestionBatch(
  params: SuggestionBatchRevertParams
): Promise<SuggestionBatchMutationResult> {
  return await getElectronApi().agent.revertSuggestionBatch(params);
}
