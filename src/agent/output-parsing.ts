import type { AgentSuggestionDraft } from "../shared/types/agent-ipc.js";
import {
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
} from "../shared/utils/assistant-content.js";

export function extractTextAfterMarker(
  content: string,
  marker: string,
  nextMarkers: readonly string[],
  fallback: string
): string {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return fallback;
  }

  const nextMarkerIndex = nextMarkers
    .map((nextMarker) => content.indexOf(nextMarker, markerIndex + marker.length))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;

  const section = nextMarkerIndex === -1
    ? content.slice(markerIndex + marker.length)
    : content.slice(markerIndex + marker.length, nextMarkerIndex);

  const normalized = section.trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function extractMarkdownSectionAfterMarker(
  content: string,
  marker: string,
  nextMarkers: readonly string[],
  fallback = ""
): string {
  return extractTextAfterMarker(content, marker, nextMarkers, fallback);
}

export function extractJsonArrayAfterMarker(content: string, marker: string): unknown[] {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) return [];

  const searchStart = markerIndex + marker.length;
  const arrayStart = content.indexOf("[", searchStart);
  if (arrayStart === -1) return [];

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = arrayStart; i < content.length; i += 1) {
    const char = content[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        const jsonText = content.slice(arrayStart, i + 1);
        try {
          const parsed = JSON.parse(jsonText);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }

  return [];
}

export function parseVisualAnalysisResponse(content: string): {
  assistantResponse: string;
  thinkingMarkdown: string;
  suggestions: AgentSuggestionDraft[];
} {
  const hasThinkingMarker = content.includes("THINKING_MARKDOWN:");
  const assistantResponse = extractTextAfterMarker(
    content,
    "ASSISTANT_RESPONSE:",
    ["THINKING_MARKDOWN:", "SUGGESTIONS_JSON:"],
    sanitizeAssistantContent(content) || "I reviewed the chapter and prepared suggestions."
  );
  const thinkingMarkdown = hasThinkingMarker
    ? extractMarkdownSectionAfterMarker(
        content,
        "THINKING_MARKDOWN:",
        ["SUGGESTIONS_JSON:"],
        sanitizeThinkingMarkdown(content)
      )
    : "";
  const rawSuggestions = extractJsonArrayAfterMarker(content, "SUGGESTIONS_JSON:");
  const suggestions = rawSuggestions
    .map((item): AgentSuggestionDraft | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      if (
        typeof record.in_point !== "number" ||
        typeof record.out_point !== "number" ||
        !Number.isFinite(record.in_point) ||
        !Number.isFinite(record.out_point) ||
        record.out_point <= record.in_point
      ) {
        return null;
      }

      return {
        in_point: record.in_point,
        out_point: record.out_point,
        description: typeof record.description === "string" ? record.description : undefined,
        reasoning: typeof record.reasoning === "string" ? record.reasoning : undefined,
      };
    })
    .filter((item): item is AgentSuggestionDraft => item !== null);

  return {
    assistantResponse,
    thinkingMarkdown,
    suggestions,
  };
}

export function parseTimelineEditResponse(content: string): {
  assistantResponse: string;
  thinkingMarkdown: string;
  timelineActions: unknown[];
  transcriptDetailRequests: unknown[];
} {
  const hasThinkingMarker = content.includes("THINKING_MARKDOWN:");
  return {
    assistantResponse: extractTextAfterMarker(
      content,
      "ASSISTANT_RESPONSE:",
      ["THINKING_MARKDOWN:", "TIMELINE_ACTIONS_JSON:", "TRANSCRIPT_DETAIL_REQUESTS_JSON:"],
      sanitizeAssistantContent(content) || "I reviewed your request and prepared timeline proposals."
    ),
    thinkingMarkdown: hasThinkingMarker
      ? extractMarkdownSectionAfterMarker(
          content,
          "THINKING_MARKDOWN:",
          ["TIMELINE_ACTIONS_JSON:", "TRANSCRIPT_DETAIL_REQUESTS_JSON:"],
          sanitizeThinkingMarkdown(content)
        )
      : "",
    timelineActions: extractJsonArrayAfterMarker(content, "TIMELINE_ACTIONS_JSON:"),
    transcriptDetailRequests: extractJsonArrayAfterMarker(content, "TRANSCRIPT_DETAIL_REQUESTS_JSON:"),
  };
}

export function parseGroundedChatResponse(content: string): {
  assistantResponse: string;
  thinkingMarkdown: string;
} {
  const hasThinkingMarker = content.includes("THINKING_MARKDOWN:");
  return {
    assistantResponse: extractTextAfterMarker(
      content,
      "ASSISTANT_RESPONSE:",
      ["THINKING_MARKDOWN:"],
      sanitizeAssistantContent(content)
    ),
    thinkingMarkdown: hasThinkingMarker
      ? extractMarkdownSectionAfterMarker(
          content,
          "THINKING_MARKDOWN:",
          [],
          sanitizeThinkingMarkdown(content)
        )
      : "",
  };
}
