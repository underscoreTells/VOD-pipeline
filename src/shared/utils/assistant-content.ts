const PAYLOAD_SECTION_MARKERS = [
  "SUGGESTIONS_JSON:",
  "TIMELINE_ACTIONS_JSON:",
  "TRANSCRIPT_DETAIL_REQUESTS_JSON:",
] as const;

const RESPONSE_SECTION_MARKERS = [
  "THINKING_MARKDOWN:",
  ...PAYLOAD_SECTION_MARKERS,
] as const;

function extractMarkedSection(
  content: string,
  marker: string,
  nextMarkers: readonly string[]
): string | null {
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const nextMarkerIndex = nextMarkers
    .map((nextMarker) => content.indexOf(nextMarker, markerIndex + marker.length))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;

  const section = nextMarkerIndex === -1
    ? content.slice(markerIndex + marker.length)
    : content.slice(markerIndex + marker.length, nextMarkerIndex);

  const normalized = section.trim();
  return normalized.length > 0 ? normalized : null;
}

export function stripLegacySuggestionBlocks(content: string): string {
  const suggestionMarker = "SUGGESTION:";
  let remaining = content;
  let markerIndex = remaining.indexOf(suggestionMarker);

  while (markerIndex !== -1) {
    const jsonStart = markerIndex + suggestionMarker.length;
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
    markerIndex = remaining.indexOf(suggestionMarker);
  }

  return remaining;
}

export function sanitizeAssistantContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return trimmed;
  }

  const assistantResponse = extractMarkedSection(
    trimmed,
    "ASSISTANT_RESPONSE:",
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
    "THINKING_MARKDOWN:",
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
