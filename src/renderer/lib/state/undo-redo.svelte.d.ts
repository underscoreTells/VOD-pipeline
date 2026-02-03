export interface Command {
    description: string;
    execute(): void;
    undo(): void;
}
export declare function canUndo(): boolean;
export declare function canRedo(): boolean;
export declare function getLastCommandDescription(): string | null;
export declare function getNextRedoDescription(): string | null;
export declare function executeCommand(command: Command): void;
export declare function undo(): boolean;
export declare function redo(): boolean;
export declare function clearHistory(): void;
export declare class MoveClipCommand implements Command {
    description: string;
    private clipId;
    private oldStartTime;
    private newStartTime;
    constructor(description: string, clipId: number, oldStartTime: number, newStartTime: number);
    execute(): void;
    undo(): void;
}
export declare class ResizeClipCommand implements Command {
    description: string;
    private clipId;
    private oldInPoint;
    private oldOutPoint;
    private newInPoint;
    private newOutPoint;
    constructor(description: string, clipId: number, oldInPoint: number, oldOutPoint: number, newInPoint: number, newOutPoint: number);
    execute(): void;
    undo(): void;
}
export declare class DeleteClipCommand implements Command {
    description: string;
    private clipId;
    private clipData;
    constructor(description: string, clipId: number);
    execute(): void;
    undo(): void;
}
export declare class MultiMoveCommand implements Command {
    description: string;
    private moves;
    constructor(description: string, moves: Array<{
        clipId: number;
        oldStartTime: number;
        newStartTime: number;
    }>);
    execute(): void;
    undo(): void;
}
