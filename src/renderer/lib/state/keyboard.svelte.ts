import {
  undo,
  redo,
  canUndo,
  canRedo,
  executeCommand,
  MoveClipCommand,
  ResizeClipCommand,
  DeleteClipCommand,
} from './undo-redo.svelte';
import {
  timelineState,
  togglePlayback,
  selectAll,
  clearSelection,
  zoomIn,
  zoomOut,
  zoomToFit,
  deleteClip,
  setPlayhead,
  getTotalDuration,
} from './timeline.svelte';

// Keyboard shortcuts configuration
const SHORTCUTS = {
  // Playback
  'Space': togglePlayback,
  
  // Navigation
  'ArrowLeft': () => nudgePlayhead(-1),
  'ArrowRight': () => nudgePlayhead(1),
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
  'Escape': clearSelection,
  
  // Zoom
  'Equal': zoomIn,      // + key
  'Minus': zoomOut,     // - key
  'f': zoomToFit,
  
  // Clip editing
  'i': setInPoint,
  'o': setOutPoint,
} as const;

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
  
  parts.push(event.key);
  
  return parts.join('+');
}

// Nudge playhead by frames
function nudgePlayhead(frames: number) {
  const fps = 30; // Assume 30fps
  const frameDuration = 1 / fps;
  const newTime = timelineState.playheadTime + (frames * frameDuration);
  setPlayhead(Math.max(0, newTime));
}

// Handle delete key
function handleDelete() {
  if (timelineState.selectedClipIds.size === 0) return;
  
  // Create delete commands for all selected clips
  const selectedIds = Array.from(timelineState.selectedClipIds);
  
  // Execute commands through undo-redo system
  for (const clipId of selectedIds) {
    const command = new DeleteClipCommand('Delete clip', clipId);
    executeCommand(command);
  }
}

// Set in point on selected clip
function setInPoint() {
  // TODO: Implement when clip editing UI is ready
  console.log('Set in point - not implemented');
}

// Set out point on selected clip
function setOutPoint() {
  // TODO: Implement when clip editing UI is ready
  console.log('Set out point - not implemented');
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
    handler();
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
