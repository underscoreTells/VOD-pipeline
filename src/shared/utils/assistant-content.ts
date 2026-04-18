const ASSISTANT_RESPONSE_MARKER = "ASSISTANT_RESPONSE:";
const THINKING_MARKDOWN_MARKER = "THINKING_MARKDOWN:";
const LEGACY_SUGGESTION_MARKER = "SUGGESTION:";

const PAYLOAD_SECTION_MARKERS = [
  "SUGGESTIONS_JSON:",
  "TIMELINE_ACTIONS_JSON:",
  "TRANSCRIPT_DETAIL_REQUESTS_JSON:",
] as const;

const RESPONSE_SECTION_MARKERS = [
  THINKING_MARKDOWN_MARKER,
  ...PAYLOAD_SECTION_MARKERS,
] as const;

const PREVIEW_SECTION_MARKERS = [
  ASSISTANT_RESPONSE_MARKER,
  THINKING_MARKDOWN_MARKER,
  ...PAYLOAD_SECTION_MARKERS,
  LEGACY_SUGGESTION_MARKER,
] as const;

function findNextMarkerIndex(
  content: string,
  startIndex: number,
  nextMarkers: readonly string[]
): number {
  return nextMarkers
    .map((nextMarker) => content.indexOf(nextMarker, startIndex))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;
}

function extractMarkedSection(
  content: string,
  marker: string,
  nextMarkers: readonly string[]
): string | null {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const nextMarkerIndex = findNextMarkerIndex(content, markerIndex + marker.length, nextMarkers);

  const section = nextMarkerIndex === -1
    ? content.slice(markerIndex + marker.length)
    : content.slice(markerIndex + marker.length, nextMarkerIndex);

  const normalized = section.trim();
  return normalized.length > 0 ? normalized : null;
}

export function stripLegacySuggestionBlocks(content: string): string {
  let remaining = content;
  let markerIndex = remaining.indexOf(LEGACY_SUGGESTION_MARKER);

  while (markerIndex !== -1) {
    const jsonStart = markerIndex + LEGACY_SUGGESTION_MARKER.length;
    let braceCount = 0;
    let jsonEnd = -1;
    let inString = false;
    let escaped = false;

    for (let i = jsonStart; i < remaining.length; i += 1) {
      const char = remaining[i];

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

      if (inString) {
        continue;
      }

      if (char === "{") {
        braceCount += 1;
        continue;
      }

      if (char === "}") {
        braceCount -= 1;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }

    if (jsonEnd === -1) {
      remaining = remaining.slice(0, markerIndex).trimEnd();
      break;
    }

    const blockEnd = remaining.slice(jsonEnd).match(/^\s*\n?/)?.[0].length ?? 0;
    remaining = `${remaining.slice(0, markerIndex).trimEnd()}\n${remaining.slice(jsonEnd + blockEnd).trimStart()}`;
    markerIndex = remaining.indexOf(LEGACY_SUGGESTION_MARKER);
  }

  return remaining;
}

function stripTrailingPartialMarker(content: string, markers: readonly string[]): string {
  let result = content;
  let stripped = true;

  while (stripped) {
    stripped = false;

    for (const marker of markers) {
      for (let prefixLength = marker.length - 1; prefixLength >= 6; prefixLength -= 1) {
        const prefix = marker.slice(0, prefixLength);
        if (!result.endsWith(prefix)) {
          continue;
        }

        result = result.slice(0, -prefix.length).trimEnd();
        stripped = true;
        break;
      }

      if (stripped) {
        break;
      }
    }
  }

  return result;
}

function normalizePreviewSection(section: string, trailingMarkers: readonly string[]): string {
  return stripTrailingPartialMarker(
    stripLegacySuggestionBlocks(section)
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    trailingMarkers
  ).trim();
}

function extractPreviewSection(
  content: string,
  marker: string,
  nextMarkers: readonly string[]
): string | null {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const nextMarkerIndex = findNextMarkerIndex(content, markerIndex + marker.length, nextMarkers);
  const section = nextMarkerIndex === -1
    ? content.slice(markerIndex + marker.length)
    : content.slice(markerIndex + marker.length, nextMarkerIndex);

  return normalizePreviewSection(section, PREVIEW_SECTION_MARKERS);
}

export function parseStructuredAssistantPreview(content: string): {
  assistantResponse: string;
  thinkingMarkdown: string | null;
} {
  const trimmed = content.trimStart();
  if (!trimmed) {
    return {
      assistantResponse: "",
      thinkingMarkdown: null,
    };
  }

  const assistantResponse = extractPreviewSection(
    trimmed,
    ASSISTANT_RESPONSE_MARKER,
    RESPONSE_SECTION_MARKERS
  );
  const thinkingMarkdown = extractPreviewSection(
    trimmed,
    THINKING_MARKDOWN_MARKER,
    PAYLOAD_SECTION_MARKERS
  );

  const fallbackVisible = assistantResponse === null
    ? normalizePreviewSection(trimmed, PREVIEW_SECTION_MARKERS)
    : assistantResponse;
  const visibleOnly = assistantResponse === null
    ? stripTrailingPartialMarker(
        (() => {
          const structuredMarkerIndex = PREVIEW_SECTION_MARKERS
            .map((marker) => fallbackVisible.indexOf(marker))
            .filter((index) => index !== -1)
            .sort((a, b) => a - b)[0] ?? -1;

          return structuredMarkerIndex === -1
            ? fallbackVisible
            : fallbackVisible.slice(0, structuredMarkerIndex).trimEnd();
        })(),
        PREVIEW_SECTION_MARKERS
      )
    : fallbackVisible;

  return {
    assistantResponse: visibleOnly.trim(),
    thinkingMarkdown: thinkingMarkdown && thinkingMarkdown.length > 0 ? thinkingMarkdown : null,
  };
}

export function sanitizeAssistantContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return trimmed;
  }

  const assistantResponse = extractMarkedSection(
    trimmed,
    ASSISTANT_RESPONSE_MARKER,
    RESPONSE_SECTION_MARKERS
  );
  if (assistantResponse) {
    return assistantResponse;
  }

  const withoutLegacySuggestions = stripLegacySuggestionBlocks(trimmed);
  const structuredMarkerIndex = RESPONSE_SECTION_MARKERS
    .map((marker) => withoutLegacySuggestions.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;

  const visibleOnly = structuredMarkerIndex === -1
    ? withoutLegacySuggestions
    : withoutLegacySuggestions.slice(0, structuredMarkerIndex);

  return visibleOnly
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeThinkingMarkdown(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const thinkingContent = extractMarkedSection(
    trimmed,
    THINKING_MARKDOWN_MARKER,
    PAYLOAD_SECTION_MARKERS
  );

  const baseContent = thinkingContent ?? trimmed;
  const withoutLegacySuggestions = stripLegacySuggestionBlocks(baseContent);
  const structuredMarkerIndex = PAYLOAD_SECTION_MARKERS
    .map((marker) => withoutLegacySuggestions.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;

  const visibleOnly = structuredMarkerIndex === -1
    ? withoutLegacySuggestions
    : withoutLegacySuggestions.slice(0, structuredMarkerIndex);

  return visibleOnly
    .replace(/^THINKING_MARKDOWN:\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
