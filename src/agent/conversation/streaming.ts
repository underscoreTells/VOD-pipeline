/**
 * Streaming support for conversation turns.
 *
 * The user-facing reply is delivered through the `finalizeConversationTurn`
 * tool call's `assistantResponse` argument, so "true" streaming means
 * incrementally decoding that JSON string value from streamed tool-call
 * argument chunks and forwarding the decoded characters as deltas.
 *
 * Deltas are cosmetic: the renderer replaces the draft with the canonical
 * result at turn_complete, so a partial or slightly divergent stream is
 * always corrected.
 */

const ESCAPE_MAP: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

type ExtractorState = "searching" | "in_string" | "done";

/**
 * Incrementally extracts the decoded value of one string property from a
 * progressively growing JSON document (partial tool-call args).
 */
export class IncrementalJsonStringExtractor {
  private readonly keyPattern: string;
  private buffer = "";
  private position = 0;
  private state: ExtractorState = "searching";
  private extracted = "";

  constructor(key: string) {
    this.keyPattern = JSON.stringify(key);
  }

  /** Total decoded text extracted so far. */
  get text(): string {
    return this.extracted;
  }

  get isDone(): boolean {
    return this.state === "done";
  }

  /**
   * Appends a partial-JSON fragment and returns any newly decoded
   * characters of the target string value.
   */
  push(fragment: string): string {
    if (this.state === "done" || !fragment) {
      return "";
    }
    this.buffer += fragment;

    if (this.state === "searching") {
      if (!this.tryEnterString()) {
        return "";
      }
    }

    return this.consumeString();
  }

  private tryEnterString(): boolean {
    const keyIndex = this.buffer.indexOf(this.keyPattern, this.position);
    if (keyIndex < 0) {
      // Keep the tail so a key split across fragments is still found.
      this.position = Math.max(0, this.buffer.length - this.keyPattern.length);
      return false;
    }

    let cursor = keyIndex + this.keyPattern.length;
    while (cursor < this.buffer.length && /\s/.test(this.buffer[cursor])) cursor += 1;
    if (cursor >= this.buffer.length) return false;
    if (this.buffer[cursor] !== ":") {
      // False positive (e.g. the key appears inside another string); skip past it.
      this.position = keyIndex + this.keyPattern.length;
      return this.tryEnterString();
    }
    cursor += 1;
    while (cursor < this.buffer.length && /\s/.test(this.buffer[cursor])) cursor += 1;
    if (cursor >= this.buffer.length) return false;
    if (this.buffer[cursor] !== '"') {
      // Value is not a string; nothing to stream.
      this.state = "done";
      return false;
    }

    this.position = cursor + 1;
    this.state = "in_string";
    return true;
  }

  private consumeString(): string {
    let output = "";

    while (this.position < this.buffer.length) {
      const char = this.buffer[this.position];

      if (char === '"') {
        this.position += 1;
        this.state = "done";
        break;
      }

      if (char === "\\") {
        if (this.position + 1 >= this.buffer.length) {
          break; // incomplete escape; wait for more input
        }
        const escapeChar = this.buffer[this.position + 1];
        if (escapeChar === "u") {
          if (this.position + 6 > this.buffer.length) {
            break; // incomplete \uXXXX; wait for more input
          }
          const hex = this.buffer.slice(this.position + 2, this.position + 6);
          const codePoint = Number.parseInt(hex, 16);
          output += Number.isNaN(codePoint) ? "" : String.fromCharCode(codePoint);
          this.position += 6;
          continue;
        }
        output += ESCAPE_MAP[escapeChar] ?? escapeChar;
        this.position += 2;
        continue;
      }

      output += char;
      this.position += 1;
    }

    this.extracted += output;
    return output;
  }
}

const TRANSIENT_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const TRANSIENT_ERROR_PATTERNS = [
  /rate[ _-]?limit/i,
  /overloaded/i,
  /timeout/i,
  /timed out/i,
  /econnreset/i,
  /econnrefused/i,
  /socket hang up/i,
  /fetch failed/i,
  /service unavailable/i,
];

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const value of [candidate.status, candidate.statusCode, candidate.code]) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  }
  return undefined;
}

export function isTransientLLMError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== undefined && TRANSIENT_STATUS_CODES.has(status)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export interface LLMRetryOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Return false to disable retry (e.g. once output was already streamed). */
  canRetry?: () => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Retries a model call on transient errors (429/5xx/network) with
 * exponential backoff and jitter. Never retries after abort.
 */
export async function withLLMRetry<T>(
  operation: () => Promise<T>,
  options: LLMRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new Error("Conversation turn aborted");
    }
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retriable =
        attempt < maxAttempts &&
        !options.signal?.aborted &&
        isTransientLLMError(error) &&
        (options.canRetry?.() ?? true);
      if (!retriable) {
        throw error;
      }
      options.onRetry?.(attempt, error);
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Conversation turn aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
