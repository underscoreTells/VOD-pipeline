export interface FFmpegPathResult {
    path: string;
    source: 'bundled' | 'development' | 'userData' | 'system';
    version: string;
}
/**
 * Detect FFmpeg installation using fallback cascade
 * 1. Bundled binary (production)
 * 2. Development directory
 * 3. User data directory
 * 4. System PATH
 */
export declare function detectFFmpeg(): Promise<FFmpegPathResult | null>;
/**
 * Get cached FFmpeg detection result
 */
export declare function getFFmpegPath(): FFmpegPathResult | null;
/**
 * Clear cached detection result (for testing)
 */
export declare function clearFFmpegCache(): void;
/**
 * Extract version string from FFmpeg
 */
export declare function getFFmpegVersion(executablePath: string): Promise<string | null>;
/**
 * Get ffprobe path from FFmpeg path
 */
export declare function getFFprobePath(ffmpegPath: string): string;
