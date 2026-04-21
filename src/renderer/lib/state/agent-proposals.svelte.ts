import type { Clip, Suggestion } from '../../../shared/types/database';
import {
  applyAllSuggestions as applyAllAgentSuggestions,
  applySuggestion as applyAgentSuggestion,
  cancelSuggestionPreview as cancelAgentSuggestionPreview,
  getSuggestions,
  previewSuggestion as previewAgentSuggestion,
  rejectSuggestion as rejectAgentSuggestion,
  applyAgentActions,
} from '../api/agent.js';
import {
  timelineState,
  createClip as createTimelineClip,
  deleteClip as deleteTimelineClip,
  selectClip,
  setPlayhead,
  updateClip as updateTimelineClip,
} from './timeline.svelte';
import { agentState } from './agent-session.svelte.js';

interface BulkSuggestionActionResult {
  success: boolean;
  total: number;
  succeededIds: number[];
  failedIds: number[];
  error?: string;
}

function upsertTimelineClip(clip: Clip | undefined) {
  if (!clip) return;
  const existing = timelineState.clips.find((item) => item.id === clip.id);
  if (existing) {
    updateTimelineClip(clip.id, clip);
    return;
  }
  createTimelineClip(clip);
}

function focusTimelineClip(clip: Clip | undefined) {
  if (!clip) return;
  upsertTimelineClip(clip);
  selectClip(clip.id, false);
  setPlayhead(clip.start_time);
}

function removeTimelineClipById(clipId: number | null | undefined) {
  if (!clipId) return;
  const existing = timelineState.clips.find((clip) => clip.id === clipId);
  if (existing) {
    deleteTimelineClip(clipId);
  }
}

export async function applyTimelineProposal(proposalId: string) {
  const proposal = agentState.timelineProposals.find((item) => item.id === proposalId);
  if (!proposal) {
    return { success: false, error: 'Proposal not found' };
  }
  if (proposal.status !== 'pending') {
    return { success: false, error: 'Proposal is not pending' };
  }
  if (!agentState.currentProjectId) {
    return { success: false, error: 'No project selected' };
  }

  try {
    const response = await applyAgentActions({
      projectId: agentState.currentProjectId,
      chapterId: agentState.currentChapterId || undefined,
      actions: [proposal.action],
    });

    if (!response.success || !response.data?.results?.length) {
      const error = response.error || 'Failed to apply timeline action';
      proposal.status = 'failed';
      proposal.error = error;
      return { success: false, error };
    }

    const [result] = response.data.results;
    if (!result.success) {
      const error = result.error || 'Failed to apply timeline action';
      proposal.status = 'failed';
      proposal.error = error;
      return { success: false, error };
    }

    if (result.clip) {
      upsertTimelineClip(result.clip);
    }

    proposal.status = 'applied';
    proposal.error = null;
    return { success: true, clip: result.clip };
  } catch (error) {
    const message = (error as Error).message;
    proposal.status = 'failed';
    proposal.error = message;
    return { success: false, error: message };
  }
}

export function rejectTimelineProposal(proposalId: string) {
  const proposal = agentState.timelineProposals.find((item) => item.id === proposalId);
  if (!proposal) return;
  if (proposal.status !== 'pending') return;
  proposal.status = 'rejected';
  proposal.error = null;
}

export async function loadSuggestions(chapterId: string, conversationId: number) {
  try {
    const response = await getSuggestions({ chapterId, conversationId });
    if (response.success && response.data) {
      agentState.suggestions = response.data as Suggestion[];
    }
  } catch (error) {
    console.error('Failed to load suggestions:', error);
  }
}

export async function previewSuggestion(suggestionId: number) {
  const suggestion = agentState.suggestions.find((item) => item.id === suggestionId);
  try {
    const response = await previewAgentSuggestion(suggestionId);
    if (!response.success || !response.data) {
      return { success: false, error: response.error || 'Failed to preview suggestion' };
    }

    const clip = response.data.clip;
    if (suggestion && clip) {
      suggestion.clip_id = clip.id;
      suggestion.status = 'pending';
    }

    focusTimelineClip(clip);
    return { success: true, clip };
  } catch (error) {
    console.error('Failed to preview suggestion:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function cancelSuggestionPreviewAction(suggestionId: number) {
  const suggestion = agentState.suggestions.find((item) => item.id === suggestionId);

  try {
    const response = await cancelAgentSuggestionPreview(suggestionId);
    if (!response.success) {
      return { success: false, error: response.error || 'Failed to cancel preview' };
    }

    const removedClipId = response.data?.removedClipId;
    if (removedClipId) {
      removeTimelineClipById(removedClipId);
    }

    if (response.data?.clip) {
      upsertTimelineClip(response.data.clip);
      selectClip(response.data.clip.id, false);
    }

    if (suggestion) {
      suggestion.clip_id = null;
    }

    return { success: true, removedClipId };
  } catch (error) {
    console.error('Failed to cancel suggestion preview:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function applySuggestion(suggestionId: number) {
  try {
    const response = await applyAgentSuggestion(suggestionId);
    if (response.success && response.data) {
      const result = response.data as { applied: boolean; clip?: Clip };

      const suggestion = agentState.suggestions.find((s) => s.id === suggestionId);
      if (suggestion) {
        suggestion.status = 'applied';
        if (result.clip) {
          suggestion.clip_id = result.clip.id;
        }
      }

      focusTimelineClip(result.clip);
      return { success: true, clip: result.clip };
    }
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Failed to apply suggestion:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function applyAllSuggestions() {
  if (!agentState.currentChapterId || !agentState.selectedConversationId) {
    return { success: false, error: 'No conversation selected' };
  }

  try {
    const response = await applyAllAgentSuggestions({
      chapterId: agentState.currentChapterId,
      conversationId: agentState.selectedConversationId,
    });
    if (!response.success || !response.data) {
      return { success: false, error: response.error || 'Failed to apply suggestions' };
    }

    let lastClip: Clip | undefined;

    for (const result of response.data.results) {
      const suggestion = agentState.suggestions.find((item) => item.id === result.suggestionId);
      if (!suggestion) continue;

      if (result.success) {
        suggestion.status = 'applied';
        if (result.clip) {
          suggestion.clip_id = result.clip.id;
          upsertTimelineClip(result.clip);
          lastClip = result.clip;
        }
      }
    }

    focusTimelineClip(lastClip);

    return {
      success: true,
      appliedCount: response.data.appliedCount,
      total: response.data.total,
    };
  } catch (error) {
    console.error('Failed to apply all suggestions:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function previewAllSuggestions(): Promise<BulkSuggestionActionResult> {
  const pendingSuggestions = agentState.suggestions.filter(
    (suggestion) => suggestion.status === 'pending' && suggestion.clip_id == null
  );
  const succeededIds: number[] = [];
  const failedIds: number[] = [];

  for (const suggestion of pendingSuggestions) {
    const result = await previewSuggestion(suggestion.id);
    if (result.success) {
      succeededIds.push(suggestion.id);
    } else {
      failedIds.push(suggestion.id);
    }
  }

  return {
    success: failedIds.length === 0,
    total: pendingSuggestions.length,
    succeededIds,
    failedIds,
    error: failedIds.length > 0 ? 'Failed to preview some suggestions' : undefined,
  };
}

export async function rejectSuggestion(suggestionId: number) {
  const suggestion = agentState.suggestions.find((item) => item.id === suggestionId);

  try {
    const response = await rejectAgentSuggestion(suggestionId);
    if (response.success) {
      if (suggestion) {
        suggestion.status = 'rejected';
        suggestion.clip_id = null;
      }

      const removedClipId = response.data?.removedClipId;
      if (removedClipId) {
        removeTimelineClipById(removedClipId);
      }

      if (response.data?.clip) {
        upsertTimelineClip(response.data.clip);
      }
    }
    return response.success;
  } catch (error) {
    console.error('Failed to reject suggestion:', error);
    return false;
  }
}

export async function rejectAllSuggestions(): Promise<BulkSuggestionActionResult> {
  const pendingSuggestions = agentState.suggestions.filter(
    (suggestion) => suggestion.status === 'pending'
  );
  const succeededIds: number[] = [];
  const failedIds: number[] = [];

  for (const suggestion of pendingSuggestions) {
    const result = await rejectSuggestion(suggestion.id);
    if (result) {
      succeededIds.push(suggestion.id);
    } else {
      failedIds.push(suggestion.id);
    }
  }

  return {
    success: failedIds.length === 0,
    total: pendingSuggestions.length,
    succeededIds,
    failedIds,
    error: failedIds.length > 0 ? 'Failed to reject some suggestions' : undefined,
  };
}

export function clearSuggestions() {
  agentState.suggestions = [];
}

export function clearTimelineProposals() {
  agentState.timelineProposals = [];
}
