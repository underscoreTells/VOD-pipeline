import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installStdoutProtocolGuard } from "../../src/agent/ipc/stdout-protocol.js";

describe("installStdoutProtocolGuard", () => {
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  let stderrWrites: string[];
  let stdoutWrites: string[];

  beforeEach(() => {
    stderrWrites = [];
    stdoutWrites = [];

    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    vi.restoreAllMocks();
  });

  it("redirects console.log and console.info to stderr", () => {
    installStdoutProtocolGuard();

    console.log("hello %s", "world");
    console.info({ ok: true });

    expect(stderrWrites[0]).toBe("hello world\n");
    expect(stderrWrites[1]).toContain("{ ok: true }");
    expect(stdoutWrites).toEqual([]);
  });

  it("does not intercept direct stdout protocol writes", () => {
    installStdoutProtocolGuard();

    process.stdout.write('{"type":"ready"}\n');

    expect(stdoutWrites).toEqual(['{"type":"ready"}\n']);
    expect(stderrWrites).toEqual([]);
  });

  it("leaves console.warn and console.error unchanged", () => {
    installStdoutProtocolGuard();

    expect(console.warn).toBe(originalConsoleWarn);
    expect(console.error).toBe(originalConsoleError);
    expect(console.log).not.toBe(originalConsoleLog);
    expect(console.info).not.toBe(originalConsoleInfo);
  });
});
