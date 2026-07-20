import {
  createClip as ipcCreateClip,
  deleteClip as ipcDeleteClip,
  updateClip as ipcUpdateClip,
} from '../api/clips.js';
import { splitClipAtSourceTime } from '../../../shared/utils/clip-timing.js';
import {
  timelineState,
  createClip as createTimelineClip,
  updateClip as updateTimelineClip,
} from './timeline.svelte';
import {
  enqueueClipAutoName,
  hasClipDescription,
  processClipAutoNameQueue,
} from './clip-auto-name.svelte.js';
import type { Clip } from '../../../shared/types/database';
import type { CreateClipInput } from '../../../shared/contracts/electron-api.js';

// Command pattern for undo/redo
export interface Command {
  description: string;
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
}

const MAX_HISTORY = 50;

const undoRedoState = $state({
  undoStack: [] as Command[],
  redoStack: [] as Command[],
});

let historyQueue: Promise<void> = Promise.resolve();
let historyGeneration = 0;

function enqueueHistoryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = historyQueue.then(operation, operation);
  historyQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

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

export function executeCommand(command: Command): Promise<boolean> {
  const generation = historyGeneration;
  return enqueueHistoryOperation(async () => {
    try {
      await command.execute();

      if (generation !== historyGeneration) {
        return true;
      }

      undoRedoState.undoStack.push(command);
      if (undoRedoState.undoStack.length > MAX_HISTORY) {
        undoRedoState.undoStack.shift();
      }

      undoRedoState.redoStack = [];
      return true;
    } catch (error) {
      console.error('Execute command failed:', error);
      return false;
    }
  });
}

export function undo(): Promise<boolean> {
  const generation = historyGeneration;
  return enqueueHistoryOperation(async () => {
    if (undoRedoState.undoStack.length === 0) return false;

    const command = undoRedoState.undoStack.pop()!;
    try {
      await command.undo();
      if (generation !== historyGeneration) {
        return true;
      }
      undoRedoState.redoStack.push(command);
      return true;
    } catch (error) {
      if (generation === historyGeneration) {
        undoRedoState.undoStack.push(command);
      }
      console.error('Undo failed:', error);
      return false;
    }
  });
}

export function redo(): Promise<boolean> {
  const generation = historyGeneration;
  return enqueueHistoryOperation(async () => {
    if (undoRedoState.redoStack.length === 0) return false;

    const command = undoRedoState.redoStack.pop()!;
    try {
      await command.execute();
      if (generation !== historyGeneration) {
        return true;
      }
      undoRedoState.undoStack.push(command);
      return true;
    } catch (error) {
      if (generation === historyGeneration) {
        undoRedoState.redoStack.push(command);
      }
      console.error('Redo failed:', error);
      return false;
    }
  });
}

export function clearHistory() {
  historyGeneration += 1;
  undoRedoState.undoStack = [];
  undoRedoState.redoStack = [];
}

function cloneClipForHistory(clip: Clip): Clip {
  return {
    id: clip.id,
    project_id: clip.project_id,
    asset_id: clip.asset_id,
    track_index: clip.track_index,
    in_point: clip.in_point,
    out_point: clip.out_point,
    role: clip.role,
    description: clip.description,
    is_essential: clip.is_essential,
    created_at: clip.created_at,
  };
}

type DeleteClipIpcResult = {
  success: boolean;
  error?: unknown;
  code?: unknown;
};

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (error == null) return '';
  return String(error);
}

function isNotFoundCode(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  const normalized = code.toLowerCase();
  return normalized === 'not_found' || normalized.includes('not_found') || normalized.includes('notfound');
}

function isNotFoundMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('clip not found') ||
    normalized.includes('not found') ||
    normalized.includes('no such clip') ||
    normalized.includes('not_found')
  );
}

function isAlreadyMissingDeleteResult(result: DeleteClipIpcResult): boolean {
  return isNotFoundCode(result.code) || isNotFoundMessage(normalizeErrorMessage(result.error));
}

function isAlreadyMissingDeleteError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (isNotFoundCode(code)) return true;
  }
  return isNotFoundMessage(normalizeErrorMessage(error));
}

async function persistClipUpdate(clipId: number, updates: Partial<Clip>): Promise<void> {
  const result = await ipcUpdateClip(clipId, updates);
  if (!result.success) {
    throw new Error(result.error || `Failed to update clip ${clipId}`);
  }
}

async function persistClipDelete(clipId: number): Promise<'deleted' | 'already-missing'> {
  const result = (await ipcDeleteClip(clipId)) as DeleteClipIpcResult;
  if (result.success) {
    return 'deleted';
  }

  if (isAlreadyMissingDeleteResult(result)) {
    return 'already-missing';
  }

  const errorMessage = normalizeErrorMessage(result.error);
  throw new Error(errorMessage || `Failed to delete clip ${clipId}`);
}

async function persistClipRestore(clip: Clip): Promise<void> {
  const result = await ipcCreateClip({
    id: clip.id,
    createdAt: clip.created_at,
    projectId: clip.project_id,
    assetId: clip.asset_id,
    trackIndex: clip.track_index,
    inPoint: clip.in_point,
    outPoint: clip.out_point,
    role: clip.role ?? undefined,
    description: clip.description ?? undefined,
    isEssential: clip.is_essential,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error || `Failed to restore clip ${clip.id}`);
  }

  if (result.data.id !== clip.id) {
    throw new Error(`Clip restore returned unexpected id ${result.data.id} (expected ${clip.id})`);
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

  async execute() {
    await persistClipUpdate(this.clipId, {
      in_point: this.newInPoint,
      out_point: this.newOutPoint,
    });
    updateTimelineClip(this.clipId, {
      in_point: this.newInPoint,
      out_point: this.newOutPoint,
    });
  }

  async undo() {
    await persistClipUpdate(this.clipId, {
      in_point: this.oldInPoint,
      out_point: this.oldOutPoint,
    });
    updateTimelineClip(this.clipId, {
      in_point: this.oldInPoint,
      out_point: this.oldOutPoint,
    });
  }
}

export class CreateClipCommand implements Command {
  private clip: Clip | null = null;

  constructor(
    public description: string,
    private readonly input: CreateClipInput
  ) {}

  get createdClip(): Clip | null {
    return this.clip;
  }

  async execute() {
    if (this.clip) {
      await persistClipRestore(this.clip);
      createTimelineClip(this.clip);
      if (!hasClipDescription(this.clip)) {
        enqueueClipAutoName(this.clip.id);
        void processClipAutoNameQueue();
      }
      return;
    }

    const result = await ipcCreateClip(this.input);
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to create clip');
    }
    this.clip = cloneClipForHistory(result.data);
    createTimelineClip(result.data);
  }

  async undo() {
    if (!this.clip) return;
    const clipId = this.clip.id;
    const latest = timelineState.clips.find((clip) => clip.id === clipId);
    if (latest) {
      this.clip = cloneClipForHistory(latest);
    }
    await persistClipDelete(clipId);
    timelineState.clips = timelineState.clips.filter((clip) => clip.id !== clipId);
    const nextSelectedIds = new Set(timelineState.selectedClipIds);
    nextSelectedIds.delete(clipId);
    timelineState.selectedClipIds = nextSelectedIds;
  }
}

export class UpdateClipTimingCommand implements Command {
  constructor(
    public description: string,
    private clipId: number,
    private oldInPoint: number,
    private oldOutPoint: number,
    private newInPoint: number,
    private newOutPoint: number
  ) {}

  async execute() {
    await persistClipUpdate(this.clipId, {
      in_point: this.newInPoint,
      out_point: this.newOutPoint,
    });
    updateTimelineClip(this.clipId, {
      in_point: this.newInPoint,
      out_point: this.newOutPoint,
    });
  }

  async undo() {
    await persistClipUpdate(this.clipId, {
      in_point: this.oldInPoint,
      out_point: this.oldOutPoint,
    });
    updateTimelineClip(this.clipId, {
      in_point: this.oldInPoint,
      out_point: this.oldOutPoint,
    });
  }
}

export class DeleteClipCommand implements Command {
  private clipData: { id: number; index: number; clip: Clip } | null = null;

  private removeFromTimelineState() {
    timelineState.clips = timelineState.clips.filter((clip) => clip.id !== this.clipId);
    if (timelineState.selectedClipIds.has(this.clipId)) {
      const nextSelectedIds = new Set(timelineState.selectedClipIds);
      nextSelectedIds.delete(this.clipId);
      timelineState.selectedClipIds = nextSelectedIds;
    }
  }

  private restoreToTimelineState() {
    const clipData = this.clipData;
    if (!clipData) return;

    const existingIndex = timelineState.clips.findIndex((clip) => clip.id === this.clipId);
    if (existingIndex !== -1) {
      timelineState.clips = timelineState.clips.map((clip) =>
        clip.id === this.clipId ? clipData.clip : clip
      );
      return;
    }

    const { index, clip } = clipData;
    const newClips = [...timelineState.clips];
    const insertIndex = Math.min(Math.max(index, 0), newClips.length);
    newClips.splice(insertIndex, 0, clip);
    timelineState.clips = newClips;
  }

  constructor(
    public description: string,
    private clipId: number
  ) {
    const index = timelineState.clips.findIndex((clip) => clip.id === this.clipId);
    if (index !== -1) {
      this.clipData = {
        id: this.clipId,
        index,
        clip: cloneClipForHistory(timelineState.clips[index]),
      };
    }
  }

  async execute() {
    const currentIndex = timelineState.clips.findIndex((clip) => clip.id === this.clipId);
    if (currentIndex !== -1) {
      this.clipData = {
        id: this.clipId,
        index: currentIndex,
        clip: cloneClipForHistory(timelineState.clips[currentIndex]),
      };
    }

    if (!this.clipData) {
      throw new Error(`Clip ${this.clipId} not found in timeline state`);
    }

    this.removeFromTimelineState();

    try {
      await persistClipDelete(this.clipId);
    } catch (error) {
      if (isAlreadyMissingDeleteError(error)) {
        return;
      }
      this.restoreToTimelineState();
      throw error;
    }
  }

  async undo() {
    if (this.clipData) {
      await persistClipRestore(this.clipData.clip);
      this.restoreToTimelineState();
    }
  }
}

export class SplitClipCommand implements Command {
  private rightClipSnapshot: Clip | null = null;
  private readonly splitWindow: NonNullable<ReturnType<typeof splitClipAtSourceTime>>;

  constructor(
    public description: string,
    private originalClip: Clip,
    private splitTime: number
  ) {
    const splitWindow = splitClipAtSourceTime({
      inPoint: this.originalClip.in_point,
      outPoint: this.originalClip.out_point,
      splitTime: this.splitTime,
    });

    if (!splitWindow) {
      throw new Error(`Split time ${this.splitTime} is outside clip ${this.originalClip.id}`);
    }

    this.splitWindow = splitWindow;
  }

  private removeRightClipFromTimeline() {
    if (!this.rightClipSnapshot) return;
    const rightClipId = this.rightClipSnapshot.id;

    timelineState.clips = timelineState.clips.filter((clip) => clip.id !== rightClipId);
    if (timelineState.selectedClipIds.has(rightClipId)) {
      const nextSelectedIds = new Set(timelineState.selectedClipIds);
      nextSelectedIds.delete(rightClipId);
      timelineState.selectedClipIds = nextSelectedIds;
    }
  }

  private addRightClipToTimeline(clip: Clip) {
    const existing = timelineState.clips.some((item) => item.id === clip.id);
    if (existing) return;
    createTimelineClip(clip);
  }

  async execute() {
    await persistClipUpdate(this.originalClip.id, {
      out_point: this.splitWindow.leftOutPoint,
    });
    updateTimelineClip(this.originalClip.id, {
      out_point: this.splitWindow.leftOutPoint,
    });

    try {
      if (this.rightClipSnapshot) {
        await persistClipRestore(this.rightClipSnapshot);
        this.addRightClipToTimeline(this.rightClipSnapshot);
        return;
      }

      const result = await ipcCreateClip({
        projectId: this.originalClip.project_id,
        assetId: this.originalClip.asset_id,
        trackIndex: this.originalClip.track_index,
        inPoint: this.splitWindow.rightInPoint,
        outPoint: this.splitWindow.rightOutPoint,
        role: this.originalClip.role ?? undefined,
        description: this.originalClip.description ?? undefined,
        isEssential: this.originalClip.is_essential,
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || `Failed to create split clip for clip ${this.originalClip.id}`);
      }

      this.rightClipSnapshot = cloneClipForHistory(result.data);
      this.addRightClipToTimeline(result.data);
    } catch (error) {
      await persistClipUpdate(this.originalClip.id, {
        out_point: this.originalClip.out_point,
      });
      updateTimelineClip(this.originalClip.id, {
        out_point: this.originalClip.out_point,
      });
      throw error;
    }
  }

  async undo() {
    await persistClipUpdate(this.originalClip.id, {
      out_point: this.originalClip.out_point,
    });
    updateTimelineClip(this.originalClip.id, {
      out_point: this.originalClip.out_point,
    });

    if (!this.rightClipSnapshot) return;
    await persistClipDelete(this.rightClipSnapshot.id);
    this.removeRightClipFromTimeline();
  }
}
