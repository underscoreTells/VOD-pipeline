/**
 * Time formatting utilities
 */
/**
 * Format seconds to HH:MM:SS or MM:SS
 */
export declare function formatTime(seconds: number): string;
/**
 * Format seconds to MM:SS.ms (for precise editing)
 */
export declare function formatTimePrecise(seconds: number): string;
/**
 * Parse time string (HH:MM:SS or MM:SS) to seconds
 */
export declare function parseTime(timeStr: string): number | null;
