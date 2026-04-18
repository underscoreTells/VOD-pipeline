import type { ExecutionTraceEntry } from "../types/database.js";

const STREAM_STATUS_LABELS: Record<string, string> = {
  processing_chat: "Thinking...",
  analyzing_video: "Analyzing video...",
  planning_timeline_edits: "Planning timeline edits...",
  loading_detailed_transcript_context: "Fetching detailed transcript for a better answer...",
};

type TraceEventLike = {
  status: string;
  message?: string;
  nodeName?: string;
  passIndex?: number;
};

export function humanizeExecutionStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

export function getExecutionTraceLabel(status: string, message?: string): string {
  return message ?? STREAM_STATUS_LABELS[status] ?? humanizeExecutionStatus(status);
}

export function createExecutionTraceEntry(
  event: TraceEventLike,
  createdAt = new Date().toISOString()
): ExecutionTraceEntry {
  const label = getExecutionTraceLabel(event.status, event.message);
  const passIndex = typeof event.passIndex === "number" ? event.passIndex : undefined;
  const nodeName = typeof event.nodeName === "string" && event.nodeName.length > 0
    ? event.nodeName
    : undefined;

  return {
    id: `${passIndex ?? 0}:${nodeName ?? "unknown"}:${event.status}:${label}`,
    status: event.status,
    label,
    nodeName,
    passIndex,
    createdAt,
  };
}

export function appendExecutionTraceEntry(
  entries: ExecutionTraceEntry[],
  event: TraceEventLike,
  createdAt = new Date().toISOString()
): ExecutionTraceEntry[] {
  const entry = createExecutionTraceEntry(event, createdAt);
  if (entries.some((existing) => existing.id === entry.id)) {
    return entries;
  }
  return [...entries, entry];
}

export function parseExecutionTraceJson(value: string | null | undefined): ExecutionTraceEntry[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item): ExecutionTraceEntry | null => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as Record<string, unknown>;
        if (
          typeof record.id !== "string" ||
          typeof record.status !== "string" ||
          typeof record.label !== "string" ||
          typeof record.createdAt !== "string"
        ) {
          return null;
        }

        return {
          id: record.id,
          status: record.status,
          label: record.label,
          nodeName: typeof record.nodeName === "string" ? record.nodeName : undefined,
          passIndex: typeof record.passIndex === "number" ? record.passIndex : undefined,
          createdAt: record.createdAt,
        };
      })
      .filter((entry): entry is ExecutionTraceEntry => entry !== null);
  } catch {
    return [];
  }
}

export function serializeExecutionTrace(entries: ExecutionTraceEntry[]): string | null {
  return entries.length > 0 ? JSON.stringify(entries) : null;
}
