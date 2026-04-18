import type { Chapter } from "$shared/types/database";
import { formatTime } from "../utils/time.js";

export function formatChapterRange(chapter: Pick<Chapter, "start_time" | "end_time">): string {
  return `[${formatTime(chapter.start_time)} - ${formatTime(chapter.end_time)}]`;
}
