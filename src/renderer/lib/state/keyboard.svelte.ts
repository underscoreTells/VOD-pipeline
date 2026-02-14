import { undo, redo } from './undo-redo.svelte';
import type { Clip } from '$shared/types/database';
import {
  timelineState,
  togglePlayback,
  selectAll,
  clearSelection as clearTimelineSelection,
  zoomIn,
  zoomOut,
  zoomToFit,
  setPlayhead,
} from './timeline.svelte';
import { executeDeleteClip } from './project-detail.svelte';
import { getSelectedChapter, getAssetsForChapter } from './chapters.svelte';
import {
  clipBuilderState,
  setInPoint as setClipInPoint,
  setOutPoint as setClipOutPoint,
  clearSelection as clearClipSelection,
} from './clip-builder.svelte';

type ShortcutHandler = () => void | Promise<unknown>;

// Keyboard shortcuts configuration
const SHORTCUTS: Record<string, ShortcutHandler> = {
  // Playback
  'Space': togglePlayback,
  
  // Navigation
  'ArrowLeft': () => handleArrowNavigation('previous', -1),
  'ArrowRight': () => handleArrowNavigation('next', 1),
  'Shift+ArrowLeft': () => nudgePlayhead(-10),
  'Shift+ArrowRight': () => nudgePlayhead(10),
  
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
  
  // Clip editing
  'i': markInPoint,
  'o': markOutPoint,
  'Ctrl+b': toggleInOut,
};

// Track if user is in an input field
function isInputFieldActive(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  
  const tagName = activeElement.tagName.toLowerCase();
  const isEditable = activeElement.getAttribute('contenteditable') === 'true';
  
  return tagName === 'input' || tagName === 'textarea' || isEditable;
}

// Get shortcut key string
function getShortcutKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  
  // Use event.code for Space to ensure reliable detection
  const key = event.code === 'Space' ? 'Space' : event.key;
  parts.push(key);
  
  return parts.join('+');
}

// Nudge playhead by frames
function nudgePlayhead(frames: number) {
  const fps = 30; // Assume 30fps
  const frameDuration = 1 / fps;
  const newTime = timelineState.playheadTime + (frames * frameDuration);
  setPlayhead(Math.max(0, newTime));
}

function getChapterScopedClips(): Clip[] {
  const selectedChapter = getSelectedChapter();
  if (!selectedChapter) {
    return [...timelineState.clips].sort((a, b) =>
      Math.abs(a.start_time - b.start_time) > 0.0001 ? a.start_time - b.start_time : a.id - b.id
    );
  }

  const chapterAssetIds = new Set(getAssetsForChapter(selectedChapter.id));
  const chapterStart = selectedChapter.start_time;
  const chapterEnd = selectedChapter.end_time;

  return timelineState.clips
    .filter((clip) => {
      if (chapterAssetIds.size > 0 && !chapterAssetIds.has(clip.asset_id)) return false;
      const duration = clip.out_point - clip.in_point;
      if (!Number.isFinite(duration) || duration <= 0) return false;
      const clipStart = clip.start_time;
      const clipEnd = clip.start_time + duration;
      return clipEnd > chapterStart && clipStart < chapterEnd;
    })
    .sort((a, b) =>
      Math.abs(a.start_time - b.start_time) > 0.0001 ? a.start_time - b.start_time : a.id - b.id
    );
}

function jumpToAdjacentClip(direction: 'previous' | 'next'): boolean {
  const clips = getChapterScopedClips();
  if (clips.length === 0) return false;

  const playhead = timelineState.playheadTime;
  const epsilon = 0.01;

  if (direction === 'next') {
    const nextClip = clips.find((clip) => clip.start_time > playhead + epsilon);
    if (!nextClip) return false;
    setPlayhead(nextClip.start_time);
    return true;
  }

  for (let i = clips.length - 1; i >= 0; i -= 1) {
    if (clips[i].start_time < playhead - epsilon) {
      setPlayhead(clips[i].start_time);
      return true;
    }
  }

  return false;
}

function handleArrowNavigation(direction: 'previous' | 'next', fallbackFrames: number) {
  if (timelineState.excludeCutContent) {
    const jumped = jumpToAdjacentClip(direction);
    if (jumped) {
      return;
    }
  }

  nudgePlayhead(fallbackFrames);
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
  const fps = 30;
  const totalFrames = Math.floor(seconds * fps);
  
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

// Format time as MM:SS.ms
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}
