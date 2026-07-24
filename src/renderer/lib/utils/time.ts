/**
 * Time formatting utilities
 */

/**
 * Format seconds to HH:MM:SS or MM:SS
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";

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
export function formatTimePrecise(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00.00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

export function formatTimecode(seconds: number, fps: number): string {
  const normalizedFps = Number.isFinite(fps) ? Math.max(1, Math.min(240, Math.round(fps))) : 30;
  const normalizedSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalFrames = Math.round(normalizedSeconds * normalizedFps);
  const frames = totalFrames % normalizedFps;
  const totalSeconds = Math.floor(totalFrames / normalizedFps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

/**
 * Parse time string (HH:MM:SS or MM:SS) to seconds
 */
export function parseTime(timeStr: string): number | null {
  const parts = timeStr.split(":").map((p) => parseInt(p, 10));

  if (parts.some((p) => isNaN(p))) return null;

  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    // Just seconds
    return parts[0];
  }

  return null;
}
