import type { Asset, Clip } from '../../../shared/types/database';
export declare const projectDetail: {
    projectId: number | null;
    assets: Asset[];
    isLoadingAssets: boolean;
    isLoadingClips: boolean;
    isGeneratingWaveform: boolean;
    waveformProgress: {
        assetId: number;
        tier: number;
        percent: number;
        status: string;
    };
    exportFormats: Array<{
        id: string;
        name: string;
        description: string;
        extension: string;
    }>;
};
export declare function loadProjectDetail(projectId: number): Promise<void>;
export declare function addAssetToProject(projectId: number, filePath: string): Promise<Asset | null>;
export declare function createProjectClip(projectId: number, assetId: number, trackIndex: number, startTime: number, inPoint: number, outPoint: number, role?: Clip['role'], description?: string, isEssential?: boolean): Promise<Clip | null>;
export declare function updateProjectClip(id: number, updates: Partial<Clip>): Promise<boolean>;
export declare function deleteProjectClip(id: number): Promise<boolean>;
export declare function executeMoveClip(clipId: number, oldStartTime: number, newStartTime: number): Promise<void>;
export declare function executeResizeClip(clipId: number, oldInPoint: number, oldOutPoint: number, newInPoint: number, newOutPoint: number): Promise<void>;
export declare function executeDeleteClip(clipId: number): Promise<void>;
export declare function saveProjectTimelineState(): Promise<void>;
export declare function generateAssetWaveform(assetId: number, trackIndex?: number): Promise<void>;
export declare function getAssetWaveform(assetId: number, trackIndex: number, tierLevel: number): Promise<import("./electron.svelte").WaveformData | null>;
export declare function exportProjectToFile(projectId: number, format: string, filePath: string): Promise<boolean>;
export declare function clearProjectDetail(): void;
