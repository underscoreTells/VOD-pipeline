/**
 * Time formatting utilities
 */
/**
 * Format seconds to HH:MM:SS or MM:SS
 */
export function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0)
        return "0:00";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
/**
 * Format seconds to MM:SS.ms (for precise editing)
 */
export function formatTimePrecise(seconds) {
    if (isNaN(seconds) || seconds < 0)
        return "0:00.00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
/**
 * Parse time string (HH:MM:SS or MM:SS) to seconds
 */
export function parseTime(timeStr) {
    const parts = timeStr.split(":").map((p) => parseInt(p, 10));
    if (parts.some((p) => isNaN(p)))
        return null;
    if (parts.length === 3) {
        // HH:MM:SS
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    else if (parts.length === 2) {
        // MM:SS
        return parts[0] * 60 + parts[1];
    }
    else if (parts.length === 1) {
        // Just seconds
        return parts[0];
    }
    return null;
}
