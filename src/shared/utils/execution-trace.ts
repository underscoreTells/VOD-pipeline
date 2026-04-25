import type { ExecutionTraceEntry } from "../types/database.js";

const STREAM_STATUS_LABELS: Record<string, string> = {
  processing_chat: "Thinking...",
  analyzing_video: "Analyzing video...",
  planning_timeline_edits: "Planning timeline edits...",
  loading_detailed_transcript_context: "Fetching detailed transcript for a better answer...",
};

const TURN_STEP_LABEL_PATTERN = /Working on turn step (\d+)\.\.\./i;

type TraceEventLike = {
  status: string;
  message?: string;
  nodeName?: string;
  passIndex?: number;
  stepIndex?: number;
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
  const stepIndex = typeof event.stepIndex === "number" ? event.stepIndex : undefined;

  return {
    id: `${stepIndex ?? "na"}:${passIndex ?? "na"}:${nodeName ?? "unknown"}:${event.status}:${label}`,
    status: event.status,
    label,
    nodeName,
    passIndex,
    stepIndex,
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

export function getLatestExecutionTraceEntry(
  entries: ExecutionTraceEntry[]
): ExecutionTraceEntry | null {
  if (entries.length === 0) {
    return null;
  }

  return entries[entries.length - 1] ?? null;
}

export function getExecutionTraceStepIndex(
  entry: Pick<ExecutionTraceEntry, "label" | "stepIndex">
): number | undefined {
  if (typeof entry.stepIndex === "number" && Number.isFinite(entry.stepIndex)) {
    return entry.stepIndex;
  }

  const match = entry.label.match(TURN_STEP_LABEL_PATTERN);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function countExecutionTraceSteps(entries: ExecutionTraceEntry[]): number {
  if (entries.length === 0) {
    return 0;
  }

  const uniqueSteps = new Set<number>();
  for (const entry of entries) {
    const stepIndex = getExecutionTraceStepIndex(entry);
    if (typeof stepIndex === "number") {
      uniqueSteps.add(stepIndex);
    }
  }

  return uniqueSteps.size > 0 ? uniqueSteps.size : 1;
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
          stepIndex: typeof record.stepIndex === "number" ? record.stepIndex : undefined,
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
