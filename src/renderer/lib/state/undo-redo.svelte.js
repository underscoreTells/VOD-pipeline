import { timelineState, updateClip } from './timeline.svelte';
// Undo/Redo state
const MAX_HISTORY = 50;
const undoRedoState = $state({
    undoStack: [],
    redoStack: [],
});
// Derived state
export function canUndo() {
    return undoRedoState.undoStack.length > 0;
}
export function canRedo() {
    return undoRedoState.redoStack.length > 0;
}
export function getLastCommandDescription() {
    const lastCommand = undoRedoState.undoStack[undoRedoState.undoStack.length - 1];
    return lastCommand?.description ?? null;
}
export function getNextRedoDescription() {
    const nextCommand = undoRedoState.redoStack[undoRedoState.redoStack.length - 1];
    return nextCommand?.description ?? null;
}
// Execute a command and add to undo stack
export function executeCommand(command) {
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
export function undo() {
    if (undoRedoState.undoStack.length === 0)
        return false;
    const command = undoRedoState.undoStack.pop();
    try {
        command.undo();
        undoRedoState.redoStack.push(command);
        return true;
    }
    catch (error) {
        // Restore command to undo stack on failure
        undoRedoState.undoStack.push(command);
        console.error('Undo failed:', error);
        return false;
    }
}
// Redo last undone command
export function redo() {
    if (undoRedoState.redoStack.length === 0)
        return false;
    const command = undoRedoState.redoStack.pop();
    try {
        command.execute();
        undoRedoState.undoStack.push(command);
        return true;
    }
    catch (error) {
        // Restore command to redo stack on failure
        undoRedoState.redoStack.push(command);
        console.error('Redo failed:', error);
        return false;
    }
}
// Clear all history
export function clearHistory() {
    undoRedoState.undoStack = [];
    undoRedoState.redoStack = [];
}
// =============================================================================
// Command Implementations
// =============================================================================
export class MoveClipCommand {
    description;
    clipId;
    oldStartTime;
    newStartTime;
    constructor(description, clipId, oldStartTime, newStartTime) {
        this.description = description;
        this.clipId = clipId;
        this.oldStartTime = oldStartTime;
        this.newStartTime = newStartTime;
    }
    execute() {
        updateClip(this.clipId, { start_time: this.newStartTime });
    }
    undo() {
        updateClip(this.clipId, { start_time: this.oldStartTime });
    }
}
export class ResizeClipCommand {
    description;
    clipId;
    oldInPoint;
    oldOutPoint;
    newInPoint;
    newOutPoint;
    constructor(description, clipId, oldInPoint, oldOutPoint, newInPoint, newOutPoint) {
        this.description = description;
        this.clipId = clipId;
        this.oldInPoint = oldInPoint;
        this.oldOutPoint = oldOutPoint;
        this.newInPoint = newInPoint;
        this.newOutPoint = newOutPoint;
    }
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
export class DeleteClipCommand {
    description;
    clipId;
    clipData = null;
    constructor(description, clipId) {
        this.description = description;
        this.clipId = clipId;
        // Store clip data at creation (deep clone for safety)
        const index = timelineState.clips.findIndex(c => c.id === this.clipId);
        if (index !== -1) {
            this.clipData = {
                id: this.clipId,
                index,
                clip: structuredClone(timelineState.clips[index]),
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
                    clip: structuredClone(timelineState.clips[index]),
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
export class MultiMoveCommand {
    description;
    moves;
    constructor(description, moves) {
        this.description = description;
        this.moves = moves;
    }
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
