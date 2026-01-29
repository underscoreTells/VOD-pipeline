import { timelineState, updateClip } from './timeline.svelte';

// Command pattern for undo/redo
export interface Command {
  description: string;
  execute(): void;
  undo(): void;
}

// Undo/Redo state
const MAX_HISTORY = 50;

const undoRedoState = $state({
  undoStack: [] as Command[],
  redoStack: [] as Command[],
});

// Derived state
export function canUndo(): boolean {
  return undoRedoState.undoStack.length > 0;
}

export function canRedo(): boolean {
  return undoRedoState.redoStack.length > 0;
}

export function getLastCommandDescription(): string | null {
  const lastCommand = undoRedoState.undoStack[undoRedoState.undoStack.length - 1];
  return lastCommand?.description ?? null;
}

export function getNextRedoDescription(): string | null {
  const nextCommand = undoRedoState.redoStack[undoRedoState.redoStack.length - 1];
  return nextCommand?.description ?? null;
}

// Execute a command and add to undo stack
export function executeCommand(command: Command) {
  command.execute();
  
  undoRedoState.undoStack.push(command);
  
  // Limit undo stack size
  if (undoRedoState.undoStack.length > MAX_HISTORY) {
    undoRedoState.undoStack.shift();
  }
  
  // Clear redo stack on new action
  undoRedoState.redoStack = [];
}

// Undo last command
export function undo(): boolean {
  if (undoRedoState.undoStack.length === 0) return false;
  
  const command = undoRedoState.undoStack.pop()!;
  command.undo();
  undoRedoState.redoStack.push(command);
  return true;
}

// Redo last undone command
export function redo(): boolean {
  if (undoRedoState.redoStack.length === 0) return false;
  
  const command = undoRedoState.redoStack.pop()!;
  command.execute();
  undoRedoState.undoStack.push(command);
  return true;
}

// Clear all history
export function clearHistory() {
  undoRedoState.undoStack = [];
  undoRedoState.redoStack = [];
}

// =============================================================================
// Command Implementations
// =============================================================================

export class MoveClipCommand implements Command {
  constructor(
    public description: string,
    private clipId: number,
    private oldStartTime: number,
    private newStartTime: number
  ) {}

  execute() {
    updateClip(this.clipId, { start_time: this.newStartTime });
  }

  undo() {
    updateClip(this.clipId, { start_time: this.oldStartTime });
  }
}

export class ResizeClipCommand implements Command {
  constructor(
    public description: string,
    private clipId: number,
    private oldInPoint: number,
    private oldOutPoint: number,
    private newInPoint: number,
    private newOutPoint: number
  ) {}

  execute() {
    updateClip(this.clipId, {
      in_point: this.newInPoint,
      out_point: this.newOutPoint,
    });
  }

  undo() {
    updateClip(this.clipId, {
      in_point: this.oldInPoint,
      out_point: this.oldOutPoint,
    });
  }
}

export class DeleteClipCommand implements Command {
  private clipData: { id: number; index: number; clip: typeof timelineState.clips[0] } | null = null;

  constructor(
    public description: string,
    private clipId: number
  ) {
    // Store clip data at creation
    const index = timelineState.clips.findIndex(c => c.id === this.clipId);
    if (index !== -1) {
      this.clipData = {
        id: this.clipId,
        index,
        clip: { ...timelineState.clips[index] },
      };
    }
  }

  execute() {
    if (!this.clipData) {
      // First execution - store the data
      const index = timelineState.clips.findIndex(c => c.id === this.clipId);
      if (index !== -1) {
        this.clipData = {
          id: this.clipId,
          index,
          clip: { ...timelineState.clips[index] },
        };
      }
    }
    
    // Remove clip from state
    timelineState.clips = timelineState.clips.filter(c => c.id !== this.clipId);
    timelineState.selectedClipIds.delete(this.clipId);
  }

  undo() {
    if (this.clipData) {
      // Restore clip at original position
      const { index, clip } = this.clipData;
      const newClips = [...timelineState.clips];
      newClips.splice(index, 0, clip);
      timelineState.clips = newClips;
    }
  }
}

export class MultiMoveCommand implements Command {
  constructor(
    public description: string,
    private moves: Array<{
      clipId: number;
      oldStartTime: number;
      newStartTime: number;
    }>
  ) {}

  execute() {
    for (const move of this.moves) {
      updateClip(move.clipId, { start_time: move.newStartTime });
    }
  }

  undo() {
    for (const move of this.moves) {
      updateClip(move.clipId, { start_time: move.oldStartTime });
    }
  }
}
