import type { Clip, Suggestion } from '../../../shared/types/database';
import {
  applySuggestionBatch as applySuggestionBatchApi,
  getSuggestions,
  rejectSuggestionBatch as rejectSuggestionBatchApi,
  restoreSuggestionBatch,
  revertSuggestionBatch,
} from '../api/agent.js';
import { getAssetsForChapter, getSelectedChapter } from './chapters.svelte.js';
import { projectDetail } from './project-media.svelte.js';
import { rangesOverlap } from '../utils/timeline-geometry.js';
import { normalizeSuggestionWindowForChapter } from '../../../shared/utils/clip-timing.js';
import {
  createClip as createTimelineClip,
  deleteClip as deleteTimelineClip,
  selectClip,
  setPlayhead,
  timelineState,
  updateClip as updateTimelineClip,
} from './timeline.svelte.js';
import {
  executeCommand,
  type Command,
} from './undo-redo.svelte.js';
import { agentState } from './agent-session.svelte.js';

interface SuggestionBeforeSnapshot {
  clip: Pick<Clip, 'in_point' | 'out_point' | 'role' | 'description' | 'is_essential'>;
}

function parsePersistedPreviewClip(json: string | null | undefined): SuggestionBeforeSnapshot['clip'] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { clip?: Partial<Clip> };
    const clip = parsed?.clip;
    if (!clip || typeof clip !== 'object') return null;
    if (typeof clip.in_point !== 'number' || typeof clip.out_point !== 'number') return null;
    return {
      in_point: clip.in_point,
      out_point: clip.out_point,
      role: clip.role ?? null,
      description: clip.description ?? null,
      is_essential: Boolean(clip.is_essential),
    };
  } catch {
    return null;
  }
}

function upsertTimelineClip(clip: Clip | undefined): void {
  if (!clip) return;
  if (timelineState.clips.some((item) => item.id === clip.id)) {
    updateTimelineClip(clip.id, clip);
  } else {
    createTimelineClip(clip);
  }
}

function focusTimelineClip(clip: Clip | undefined, clearSuggestionSelection = true): void {
  if (!clip) return;
  upsertTimelineClip(clip);
  selectClip(clip.id, false);
  if (clearSuggestionSelection) agentState.selectedSuggestionId = null;
  setPlayhead(clip.in_point);
}

function setSuggestionStatus(ids: number[], status: Suggestion['status']): void {
  const idSet = new Set(ids);
  agentState.suggestions = agentState.suggestions.map((suggestion) =>
    idSet.has(suggestion.id)
      ? { ...suggestion, status, clip_id: status === 'applied' ? suggestion.clip_id : null }
      : suggestion
  );
}

function resolveSuggestionAssetId(suggestion: Suggestion): number | null {
  if (suggestion.target_clip_id) {
    return timelineState.clips.find((clip) => clip.id === suggestion.target_clip_id)?.asset_id ?? null;
  }
  if (suggestion.action_payload_json) {
    try {
      const payload = JSON.parse(suggestion.action_payload_json) as { create?: { assetId?: number } };
      if (typeof payload.create?.assetId === 'number') return payload.create.assetId;
    } catch {
      // The repository will report malformed action payloads on apply.
    }
  }
  if (suggestion.action_type !== 'create_clip') return null;
  const chapter = getSelectedChapter();
  if (!chapter) return null;
  const videoAssetIds = getAssetsForChapter(chapter.id).filter(
    (assetId) => projectDetail.assets.find((asset) => asset.id === assetId)?.file_type === 'video'
  );
  return videoAssetIds.length === 1 ? videoAssetIds[0] ?? null : null;
}

function mergeUpdateWindow(
  suggestion: Suggestion,
  base: { start: number; end: number },
  chapter: { start_time: number; end_time: number }
): { start: number; end: number } {
  // Mirror applyUpdateSuggestionToClip: merge the update payload onto the
  // base window so overlap checks use the resulting window, not the
  // synthetic fallback range stored on the suggestion row.
  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const clampLocal = (value: number, min: number) => Math.min(Math.max(value, min), chapterDuration);
  let inPoint = base.start;
  let outPoint = base.end;
  let updatePayload: { inPoint?: number; outPoint?: number } | undefined;
  if (suggestion.action_payload_json) {
    try {
      updatePayload = (JSON.parse(suggestion.action_payload_json) as {
        update?: { inPoint?: number; outPoint?: number };
      }).update;
    } catch {
      // The repository will report malformed action payloads on apply.
    }
  }
  if (typeof updatePayload?.inPoint === 'number' && Number.isFinite(updatePayload.inPoint)) {
    inPoint = chapter.start_time + clampLocal(updatePayload.inPoint, 0);
  }
  if (typeof updatePayload?.outPoint === 'number' && Number.isFinite(updatePayload.outPoint)) {
    const minLocalOut = clampLocal(inPoint - chapter.start_time, 0);
    outPoint = chapter.start_time + clampLocal(updatePayload.outPoint, minLocalOut);
  }
  return { start: inPoint, end: outPoint };
}

function resolveProposedWindow(
  suggestion: Suggestion,
  chapter: { start_time: number; end_time: number },
  simulatedTargets?: Map<number, { start: number; end: number }>
): { start: number; end: number } {
  if (suggestion.action_type === 'update_clip' && suggestion.target_clip_id) {
    const simulated = simulatedTargets?.get(suggestion.target_clip_id);
    const target = simulated
      ? null
      : timelineState.clips.find((clip) => clip.id === suggestion.target_clip_id);
    const base = simulated ?? (target ? { start: target.in_point, end: target.out_point } : null);
    if (base) {
      // Sequential updates to the same target merge onto the outcome of the
      // previous update, matching the backend's sequential apply order.
      const merged = mergeUpdateWindow(suggestion, base, chapter);
      simulatedTargets?.set(suggestion.target_clip_id, merged);
      return merged;
    }
  }
  return normalizeSuggestionWindowForChapter(suggestion, chapter);
}

function validateSuggestionBatch(suggestionIds: number[]): string | null {
  const chapter = getSelectedChapter();
  if (!chapter) return 'Select a chapter before applying suggested cuts.';
  const proposedByAsset = new Map<number, Array<{ start: number; end: number; owner: string }>>();
  const simulatedTargets = new Map<number, { start: number; end: number }>();

  for (const suggestionId of suggestionIds) {
    const suggestion = agentState.suggestions.find((item) => item.id === suggestionId);
    if (!suggestion || suggestion.status !== 'pending') return 'A suggested cut is no longer pending.';
    const assetId = resolveSuggestionAssetId(suggestion);
    if (!assetId) return 'A suggested cut has no unambiguous source asset.';
    const targetClipId = suggestion.action_type === 'update_clip' ? suggestion.target_clip_id : null;
    // Repeated updates to the same target share an owner so they are checked
    // against other proposed cuts rather than against each other; the
    // backend applies them sequentially to that one clip.
    const owner = targetClipId !== null ? `update:${targetClipId}` : `create:${suggestionId}`;
    const proposed = resolveProposedWindow(suggestion, chapter, simulatedTargets);
    const conflictsWithCut = timelineState.clips.some((clip) =>
      clip.asset_id === assetId
      && clip.id !== suggestion.target_clip_id
      && rangesOverlap(proposed, { start: clip.in_point, end: clip.out_point }, 0.001)
    );
    if (conflictsWithCut) return 'Resolve the overlapping suggested cut before accepting it.';
    const proposedRanges = proposedByAsset.get(assetId) ?? [];
    if (proposedRanges.some((range) => range.owner !== owner && rangesOverlap(proposed, range, 0.001))) {
      return 'Suggested cuts in this batch overlap each other.';
    }
    proposedRanges.push({ ...proposed, owner });
    proposedByAsset.set(assetId, proposedRanges);
  }
  return null;
}

class ApplySuggestionBatchCommand implements Command {
  description: string;
  private beforeSnapshots: Map<number, SuggestionBeforeSnapshot> | null = null;
  private appliedClips = new Map<number, Clip>();
  private readonly conversationId = agentState.selectedConversationId;
  private readonly chapterId = getSelectedChapter()?.id ?? null;
  private readonly projectId = projectDetail.projectId;
  private readonly updateTargets = new Map<
    number,
    { targetClipId: number; persistedPreview: SuggestionBeforeSnapshot['clip'] | null }
  >();

  constructor(private readonly suggestionIds: number[]) {
    this.description = suggestionIds.length === 1
      ? 'Apply suggested cut'
      : `Apply ${suggestionIds.length} suggested cuts`;
    // Retain update metadata now: agentState.suggestions may be replaced by a
    // conversation switch before a queued command runs. Only the clip-state
    // read is deferred to the first execute() so queued edits aren't erased.
    for (const suggestionId of suggestionIds) {
      const suggestion = agentState.suggestions.find((item) => item.id === suggestionId);
      if (!suggestion || suggestion.action_type !== 'update_clip' || !suggestion.target_clip_id) continue;
      this.updateTargets.set(suggestionId, {
        targetClipId: suggestion.target_clip_id,
        // A materialized preview means the live clip already holds the
        // previewed edit, so the pre-preview snapshot persisted on the
        // suggestion is the only correct before-state for undo.
        persistedPreview: parsePersistedPreviewClip(suggestion.preview_snapshot_json),
      });
    }
  }

  private isConversationCurrent(): boolean {
    return this.conversationId !== null && agentState.selectedConversationId === this.conversationId;
  }

  private isChapterCurrent(): boolean {
    return this.chapterId !== null && getSelectedChapter()?.id === this.chapterId;
  }

  private isProjectCurrent(): boolean {
    return this.projectId !== null && projectDetail.projectId === this.projectId;
  }

  private captureBeforeSnapshots(): Map<number, SuggestionBeforeSnapshot> {
    const snapshots = new Map<number, SuggestionBeforeSnapshot>();
    for (const [suggestionId, target] of this.updateTargets) {
      if (target.persistedPreview) {
        snapshots.set(suggestionId, { clip: { ...target.persistedPreview } });
        continue;
      }
      const clip = timelineState.clips.find((item) => item.id === target.targetClipId);
      if (!clip) continue;
      snapshots.set(suggestionId, {
        clip: {
          in_point: clip.in_point,
          out_point: clip.out_point,
          role: clip.role,
          description: clip.description,
          is_essential: clip.is_essential,
        },
      });
    }
    return snapshots;
  }

  async execute(isCurrent?: () => boolean): Promise<void> {
    // A queued command whose history generation was cleared must not mutate
    // the database at all; mid-flight invalidation is handled by the context
    // checks below, which suppress only renderer reconciliation.
    if (isCurrent && !isCurrent()) return;
    this.beforeSnapshots ??= this.captureBeforeSnapshots();
    const response = await applySuggestionBatchApi({ suggestionIds: this.suggestionIds });
    if (!response.success || !response.data) {
      // The backend may have auto-rejected malformed suggestions while
      // failing the batch; mirror that locally so they don't stay pending
      // and fail every subsequent apply as "not pending".
      if (this.isConversationCurrent() && response.autoRejectedIds?.length) {
        setSuggestionStatus(response.autoRejectedIds, 'rejected');
        if (response.autoRejectedIds.includes(agentState.selectedSuggestionId ?? -1)) {
          agentState.selectedSuggestionId = null;
        }
      }
      throw new Error(response.error || 'Failed to apply suggested cuts');
    }

    this.appliedClips.clear();
    const isProjectCurrent = this.isProjectCurrent();
    const isChapterCurrent = this.isChapterCurrent();
    const isConversationCurrent = this.isConversationCurrent();
    for (const result of response.data.results) {
      if (!result.success || !result.clip) continue;
      this.appliedClips.set(result.suggestionId, result.clip);
      if (isProjectCurrent) upsertTimelineClip(result.clip);
      if (!isConversationCurrent) continue;
      const suggestion = agentState.suggestions.find((item) => item.id === result.suggestionId);
      if (suggestion) suggestion.clip_id = result.clip.id;
    }
    if (isConversationCurrent) {
      setSuggestionStatus(this.suggestionIds, 'applied');
    }
    if (isChapterCurrent) {
      focusTimelineClip(
        this.appliedClips.get(this.suggestionIds[this.suggestionIds.length - 1]),
        isConversationCurrent
      );
    }
  }

  async undo(isCurrent?: () => boolean): Promise<void> {
    if (isCurrent && !isCurrent()) return;
    const response = await revertSuggestionBatch({
      items: this.suggestionIds.map((suggestionId) => ({
        suggestionId,
        beforeSnapshot: this.beforeSnapshots?.get(suggestionId) ?? null,
      })),
    });
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to undo suggested cuts');
    }

    if (this.isProjectCurrent()) {
      for (const suggestionId of this.suggestionIds) {
        const appliedClip = this.appliedClips.get(suggestionId);
        const restored = response.data.results.find((item) => item.suggestionId === suggestionId)?.clip;
        if (restored) {
          upsertTimelineClip(restored);
        } else if (appliedClip) {
          deleteTimelineClip(appliedClip.id);
        }
      }
    }
    if (!this.isConversationCurrent()) return;
    for (const suggestionId of this.suggestionIds) {
      const suggestion = agentState.suggestions.find((item) => item.id === suggestionId);
      if (suggestion) suggestion.clip_id = null;
    }
    setSuggestionStatus(this.suggestionIds, 'pending');
    agentState.selectedSuggestionId = this.suggestionIds[0] ?? null;
  }
}

class RejectSuggestionBatchCommand implements Command {
  description: string;
  private readonly conversationId = agentState.selectedConversationId;
  private readonly projectId = projectDetail.projectId;
  private readonly suggestionMeta = new Map<
    number,
    { actionType: Suggestion['action_type']; previewClipId: number | null }
  >();

  constructor(private readonly suggestionIds: number[]) {
    this.description = suggestionIds.length === 1
      ? 'Reject suggested cut'
      : `Reject ${suggestionIds.length} suggested cuts`;
    // Retain preview metadata now: agentState.suggestions may be replaced by
    // a conversation switch before a queued command runs, and the reject
    // response alone cannot identify deleted create-preview clips.
    for (const suggestionId of suggestionIds) {
      const suggestion = agentState.suggestions.find((item) => item.id === suggestionId);
      if (!suggestion) continue;
      this.suggestionMeta.set(suggestionId, {
        actionType: suggestion.action_type,
        previewClipId: suggestion.clip_id,
      });
    }
  }

  private isConversationCurrent(): boolean {
    return this.conversationId !== null && agentState.selectedConversationId === this.conversationId;
  }

  private isProjectCurrent(): boolean {
    return this.projectId !== null && projectDetail.projectId === this.projectId;
  }

  async execute(isCurrent?: () => boolean): Promise<void> {
    // A queued command whose history generation was cleared must not mutate
    // the database at all; mid-flight invalidation is handled by the context
    // checks below, which suppress only renderer reconciliation.
    if (isCurrent && !isCurrent()) return;
    const response = await rejectSuggestionBatchApi({ suggestionIds: this.suggestionIds });
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to reject suggested cuts');
    }
    // Reconcile preview artifacts: rejected create previews were deleted and
    // rejected update previews were restored to their original clip state.
    if (this.isProjectCurrent()) {
      for (const result of response.data.results) {
        if (!result.success) continue;
        const meta = this.suggestionMeta.get(result.suggestionId);
        if (!meta) continue;
        if (meta.actionType === 'update_clip') {
          upsertTimelineClip(result.clip);
        } else if (meta.previewClipId !== null) {
          deleteTimelineClip(meta.previewClipId);
        }
      }
    }
    if (!this.isConversationCurrent()) return;
    setSuggestionStatus(this.suggestionIds, 'rejected');
    if (this.suggestionIds.includes(agentState.selectedSuggestionId ?? -1)) {
      agentState.selectedSuggestionId = null;
    }
  }

  async undo(isCurrent?: () => boolean): Promise<void> {
    if (isCurrent && !isCurrent()) return;
    const response = await restoreSuggestionBatch({ suggestionIds: this.suggestionIds });
    if (!response.success) {
      throw new Error(response.error || 'Failed to restore suggested cuts');
    }
    if (!this.isConversationCurrent()) return;
    setSuggestionStatus(this.suggestionIds, 'pending');
    agentState.selectedSuggestionId = this.suggestionIds[0] ?? null;
  }
}

export async function loadSuggestions(chapterId: string, conversationId: number): Promise<void> {
  try {
    const response = await getSuggestions({ chapterId, conversationId });
    if (response.success && response.data) {
      agentState.suggestions = response.data;
      agentState.selectedSuggestionId = null;
    }
  } catch (error) {
    console.error('Failed to load suggestions:', error);
  }
}

export function focusSuggestion(suggestionId: number): boolean {
  const suggestion = agentState.suggestions.find(
    (item) => item.id === suggestionId && item.status === 'pending'
  );
  const chapter = getSelectedChapter();
  if (!suggestion || !chapter) return false;
  agentState.selectedSuggestionId = suggestionId;
  timelineState.selectedClipIds = new Set();
  setPlayhead(normalizeSuggestionWindowForChapter(suggestion, chapter).start);
  return true;
}

export async function applySuggestion(suggestionId: number) {
  const validationError = validateSuggestionBatch([suggestionId]);
  if (validationError) {
    agentState.error = validationError;
    return { success: false, error: validationError };
  }
  const success = await executeCommand(new ApplySuggestionBatchCommand([suggestionId]));
  if (!success) agentState.error = 'Failed to apply the suggested cut.';
  return { success };
}

export async function applyAllSuggestions() {
  const ids = agentState.suggestions
    .filter((suggestion) => suggestion.status === 'pending')
    .map((suggestion) => suggestion.id);
  if (ids.length === 0) return { success: true, appliedCount: 0, total: 0 };
  const validationError = validateSuggestionBatch(ids);
  if (validationError) {
    agentState.error = validationError;
    return { success: false, appliedCount: 0, total: ids.length, error: validationError };
  }
  const success = await executeCommand(new ApplySuggestionBatchCommand(ids));
  if (!success) agentState.error = 'No suggested cuts were applied.';
  return { success, appliedCount: success ? ids.length : 0, total: ids.length };
}

export async function rejectSuggestion(suggestionId: number): Promise<boolean> {
  const success = await executeCommand(new RejectSuggestionBatchCommand([suggestionId]));
  if (!success) agentState.error = 'Failed to reject the suggested cut.';
  return success;
}

export async function rejectAllSuggestions() {
  const ids = agentState.suggestions
    .filter((suggestion) => suggestion.status === 'pending')
    .map((suggestion) => suggestion.id);
  if (ids.length === 0) {
    return { success: true, total: 0, succeededIds: [], failedIds: [] };
  }
  const success = await executeCommand(new RejectSuggestionBatchCommand(ids));
  if (!success) agentState.error = 'No suggested cuts were rejected.';
  return {
    success,
    total: ids.length,
    succeededIds: success ? ids : [],
    failedIds: success ? [] : ids,
  };
}

export function previewAllSuggestions() {
  const ids = agentState.suggestions
    .filter((suggestion) => suggestion.status === 'pending')
    .map((suggestion) => suggestion.id);
  if (ids[0]) focusSuggestion(ids[0]);
  return Promise.resolve({
    success: true,
    total: ids.length,
    succeededIds: ids,
    failedIds: [],
  });
}

export function clearSuggestions(): void {
  agentState.suggestions = [];
  agentState.selectedSuggestionId = null;
}

export function clearTimelineProposals(): void {
  agentState.timelineProposals = [];
}
