import { undo, redo } from './undo-redo.svelte';
import type { Clip } from '$shared/types/database';
import {
  timelineState,
  togglePlayback,
  shuttleForward,
  shuttleReverse,
  stopShuttle,
  selectAll,
  clearSelection as clearTimelineSelection,
  zoomIn,
  zoomOut,
  zoomToFit,
  setPlayhead,
  getClipById,
  toggleExcludeCutContent,
} from './timeline.svelte';
import { executeDeleteClip, executeSplitClip } from './project-detail.svelte';
import { getSelectedChapter, getAssetsForChapter } from './chapters.svelte';
import {
  clipBuilderState,
  setInPoint as setClipInPoint,
  setOutPoint as setClipOutPoint,
  clearSelection as clearClipSelection,
} from './clip-builder.svelte';
import {
  clipOverlapsChapterSourceRange,
  compareClipsBySourceTime,
  splitClipAtSourceTime,
} from '../../../shared/utils/clip-timing.js';
import { vodCutState } from './vod-cut.svelte.js';
import { projectDetail } from './project-detail.svelte.js';
import { settingsState } from './settings.svelte.js';
import {
  getArrowNavigationDelta,
  isEditableKeyboardTarget,
} from '../utils/transport-shortcuts.js';
import { formatTimecode as formatFpsTimecode } from '../utils/time.js';

type ShortcutHandler = () => void | Promise<unknown>;

// Keyboard shortcuts configuration
const SHORTCUTS: Record<string, ShortcutHandler> = {
  // Playback
  'Space': togglePlayback,
  'j': shuttleReverse,
  'k': stopShuttle,
  'l': shuttleForward,
  
  // Navigation
  'Tab': () => {
    jumpToAdjacentClip('next');
  },
  'Shift+Tab': () => {
    jumpToAdjacentClip('previous');
  },
  'ArrowLeft': () => handleArrowNavigation('previous', false),
  'ArrowRight': () => handleArrowNavigation('next', false),
  'Shift+ArrowLeft': () => handleArrowNavigation('previous', true),
  'Shift+ArrowRight': () => handleArrowNavigation('next', true),
  
  // Undo/Redo
  'Ctrl+z': undo,
  'Ctrl+Shift+z': redo,
  'Ctrl+y': redo,
  
  // Selection
  'Delete': handleDelete,
  'Backspace': handleDelete,
  'Ctrl+a': selectAll,
  'Escape': clearTimelineSelection,
  
  // Zoom
  'Equal': zoomIn,      // + key
  'Minus': zoomOut,     // - key
  'f': zoomToFit,
  'Backslash': toggleExcludeCutContent,
  
  // Clip editing
  'i': markInPoint,
  'o': markOutPoint,
  'Ctrl+b': toggleInOut,
  's': splitClipAtPlayhead,
};

// Track if user is in an input field
function isInputFieldActive(): boolean {
  return isEditableKeyboardTarget(document.activeElement);
}

// Get shortcut key string
function getShortcutKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');

  const key = normalizeShortcutKey(event);
  parts.push(key);
  
  return parts.join('+');
}

function normalizeShortcutKey(event: KeyboardEvent): string {
  if (event.code === 'Space') return 'Space';
  if (event.code === 'Equal') return 'Equal';
  if (event.code === 'Minus') return 'Minus';
  if (event.code === 'Backslash') return 'Backslash';

  if (event.code.startsWith('Key') && event.code.length === 4) {
    return event.code.slice(3).toLowerCase();
  }

  const key = event.key;
  if (key.length === 1) {
    return key.toLowerCase();
  }

  return key;
}

function getTimelineFps(): number {
  const asset = projectDetail.assets.find((candidate) => candidate.id === timelineState.activeAssetId);
  const fps = asset?.metadata?.fps;
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 30;
}

function nudgePlayhead(direction: -1 | 1, coarse: boolean) {
  const chapter = getSelectedChapter();
  const delta = getArrowNavigationDelta({
    key: direction < 0 ? 'ArrowLeft' : 'ArrowRight',
    shiftKey: coarse,
    fps: getTimelineFps(),
    coarseJumpSeconds: settingsState.settings.coarseJumpSeconds,
  }) ?? 0;
  const minimum = chapter?.start_time ?? 0;
  const maximum = chapter?.end_time ?? Number.POSITIVE_INFINITY;
  setPlayhead(Math.min(maximum, Math.max(minimum, timelineState.playheadTime + delta)));
}

function getChapterScopedClips(): Clip[] {
  const selectedChapter = getSelectedChapter();
  if (!selectedChapter) {
    return [...timelineState.clips].sort(compareClipsBySourceTime);
  }

  const chapterAssetIds = new Set(getAssetsForChapter(selectedChapter.id));

  return timelineState.clips
    .filter((clip) => {
      if (chapterAssetIds.size > 0 && !chapterAssetIds.has(clip.asset_id)) return false;
      return clipOverlapsChapterSourceRange(clip, selectedChapter);
    })
    .sort(compareClipsBySourceTime);
}

function jumpToAdjacentClip(direction: 'previous' | 'next'): boolean {
  const clips = getChapterScopedClips();
  if (clips.length === 0) return false;

  const playhead = timelineState.playheadTime;
  const epsilon = 0.01;

  if (direction === 'next') {
    const nextClip = clips.find((clip) => clip.in_point > playhead + epsilon);
    if (!nextClip) return false;
    setPlayhead(nextClip.in_point);
    return true;
  }

  for (let i = clips.length - 1; i >= 0; i -= 1) {
    if (clips[i].in_point < playhead - epsilon) {
      setPlayhead(clips[i].in_point);
      return true;
    }
  }

  return false;
}

function handleArrowNavigation(direction: 'previous' | 'next', coarse: boolean) {
  if (!coarse && timelineState.excludeCutContent) {
    const jumped = jumpToAdjacentClip(direction);
    if (jumped) {
      return;
    }
  }

  nudgePlayhead(direction === 'previous' ? -1 : 1, coarse);
}

function clipContainsSplitPoint(clip: Clip, splitTime: number): boolean {
  return (
    splitClipAtSourceTime({
      inPoint: clip.in_point,
      outPoint: clip.out_point,
      splitTime,
      minDuration: 0.05,
    }) !== null
  );
}

function getSplitTargetClipAtPlayhead(): Clip | null {
  const playhead = timelineState.playheadTime;

  for (const selectedClipId of timelineState.selectedClipIds) {
    const selectedClip = getClipById(selectedClipId);
    if (selectedClip && clipContainsSplitPoint(selectedClip, playhead)) {
      return selectedClip;
    }
  }

  const clips = getChapterScopedClips();
  return clips.find((clip) => clipContainsSplitPoint(clip, playhead)) ?? null;
}

async function splitClipAtPlayhead() {
  const clip = getSplitTargetClipAtPlayhead();
  if (!clip) return;
  await executeSplitClip(clip.id, timelineState.playheadTime);
}

// Handle delete key
async function handleDelete() {
  if (timelineState.selectedClipIds.size === 0) return;
  
  // Create delete commands for all selected clips
  const selectedIds = Array.from(timelineState.selectedClipIds);
  
  for (const clipId of selectedIds) {
    await executeDeleteClip(clipId);
  }
}

// Set in point using current playhead position
function markInPoint() {
  setClipInPoint(timelineState.playheadTime);
}

// Set out point using current playhead position
function markOutPoint() {
  setClipOutPoint(timelineState.playheadTime);
}

// Toggle in/out point (Ctrl+B cycles between in and out)
function toggleInOut() {
  if (clipBuilderState.inPoint === null) {
    // No in point set - set it
    setClipInPoint(timelineState.playheadTime);
  } else if (clipBuilderState.outPoint === null) {
    // In point set but no out - set out
    setClipOutPoint(timelineState.playheadTime);
  } else {
    // Both set - clear and start over
    clearClipSelection();
    setClipInPoint(timelineState.playheadTime);
  }
}

// Handle keyboard event
export function handleKeyDown(event: KeyboardEvent): boolean {
  if (vodCutState.projectId !== null) {
    return false;
  }
  // Skip if user is in an input field
  if (isInputFieldActive()) {
    return false;
  }
  
  const shortcutKey = getShortcutKey(event);
  const handler = SHORTCUTS[shortcutKey as keyof typeof SHORTCUTS];
  
  if (handler) {
    event.preventDefault();
    const result = handler();
    if (result instanceof Promise) {
      void result.catch((error) => {
        console.error('Keyboard shortcut failed:', error);
      });
    }
    return true;
  }
  
  return false;
}

// Initialize keyboard shortcuts
export function initKeyboardShortcuts(): () => void {
  const listener = (event: KeyboardEvent) => {
    handleKeyDown(event);
  };
  
  window.addEventListener('keydown', listener);
  
  // Return cleanup function
  return () => {
    window.removeEventListener('keydown', listener);
  };
}

// Format time as HH:MM:SS:FF (at 30fps)
export function formatTimecode(seconds: number): string {
  return formatFpsTimecode(seconds, 30);
}

// Format time as MM:SS.ms
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}
