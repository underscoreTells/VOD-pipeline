import { describe, expect, it, vi } from "vitest";
import {
  IncrementalJsonStringExtractor,
  isTransientLLMError,
  withLLMRetry,
} from "../../src/agent/conversation/streaming.js";

describe("IncrementalJsonStringExtractor", () => {
  it("extracts a string value delivered in one fragment", () => {
    const extractor = new IncrementalJsonStringExtractor("assistantResponse");
    const delta = extractor.push('{"outcome":"discussion","assistantResponse":"hello world"}');
    expect(delta).toBe("hello world");
    expect(extractor.isDone).toBe(true);
    expect(extractor.text).toBe("hello world");
  });

  it("extracts across fragment boundaries, including a split key", () => {
    const extractor = new IncrementalJsonStringExtractor("assistantResponse");
    const source = '{"assistantResponse":"streaming is fun","outcome":"discussion"}';
    let collected = "";
    for (let i = 0; i < source.length; i += 3) {
      collected += extractor.push(source.slice(i, i + 3));
    }
    expect(collected).toBe("streaming is fun");
    expect(extractor.isDone).toBe(true);
  });

  it("decodes escape sequences, holding back incomplete escapes", () => {
    const extractor = new IncrementalJsonStringExtractor("text");
    let collected = "";
    collected += extractor.push('{"text":"line1\\');
    expect(collected).toBe("line1");
    collected += extractor.push('nline2 \\u00e9');
    expect(collected).toBe("line1\nline2 \u00e9");
    collected += extractor.push('"');
    expect(extractor.isDone).toBe(true);
    expect(collected).toBe("line1\nline2 \u00e9");
  });

  it("handles escaped quotes inside the value", () => {
    const extractor = new IncrementalJsonStringExtractor("text");
    const delta = extractor.push('{"text":"say \\"hi\\" now"}');
    expect(delta).toBe('say "hi" now');
    expect(extractor.isDone).toBe(true);
  });

  it("ignores the key appearing as a string value elsewhere", () => {
    const extractor = new IncrementalJsonStringExtractor("target");
    const delta = extractor.push('{"decoy":"target","target":"real"}');
    // The decoy value "target" is followed by a comma, not a colon, so the
    // extractor must skip it and find the real key.
    expect(delta).toBe("real");
  });

  it("stops at the closing quote and ignores trailing json", () => {
    const extractor = new IncrementalJsonStringExtractor("a");
    const delta = extractor.push('{"a":"done","b":"ignored"}');
    expect(delta).toBe("done");
    expect(extractor.push(',"c":"nope"}')).toBe("");
  });
});

describe("isTransientLLMError", () => {
  it("detects status codes", () => {
    expect(isTransientLLMError({ status: 429 })).toBe(true);
    expect(isTransientLLMError({ statusCode: 503 })).toBe(true);
    expect(isTransientLLMError({ status: 401 })).toBe(false);
  });

  it("detects message patterns", () => {
    expect(isTransientLLMError(new Error("Rate limit exceeded"))).toBe(true);
    expect(isTransientLLMError(new Error("socket hang up"))).toBe(true);
    expect(isTransientLLMError(new Error("invalid api key"))).toBe(false);
  });
});

describe("withLLMRetry", () => {
  it("retries transient errors and succeeds", async () => {
    let attempts = 0;
    const result = await withLLMRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("overloaded"), { status: 529 });
        }
        return "ok";
      },
      { baseDelayMs: 1 }
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not retry non-transient errors", async () => {
    let attempts = 0;
    await expect(
      withLLMRetry(
        async () => {
          attempts += 1;
          throw new Error("invalid api key");
        },
        { baseDelayMs: 1 }
      )
    ).rejects.toThrow("invalid api key");
    expect(attempts).toBe(1);
  });

  it("stops retrying when canRetry returns false", async () => {
    let attempts = 0;
    await expect(
      withLLMRetry(
        async () => {
          attempts += 1;
          throw new Error("rate limit");
        },
        { baseDelayMs: 1, canRetry: () => false }
      )
    ).rejects.toThrow("rate limit");
    expect(attempts).toBe(1);
  });

  it("gives up after maxAttempts", async () => {
    const onRetry = vi.fn();
    let attempts = 0;
    await expect(
      withLLMRetry(
        async () => {
          attempts += 1;
          throw new Error("timeout");
        },
        { baseDelayMs: 1, maxAttempts: 3, onRetry }
      )
    ).rejects.toThrow("timeout");
    expect(attempts).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("aborts immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withLLMRetry(async () => "never", { signal: controller.signal })
    ).rejects.toThrow("aborted");
  });
});
