import { describe, it, expect, beforeEach } from "vitest";
import { Writable, Readable } from "stream";
import { JSONStdinWriter, JSONStdoutReader } from "../../src/agent/ipc/json-message-transport.js";

describe("JSONStdinWriter", () => {
  let mockWritable: Writable;
  let writer: JSONStdinWriter;
  let writeCalls: string[];

  beforeEach(() => {
    writeCalls = [];
    mockWritable = new Writable({
      write: (chunk, encoding, callback) => {
        writeCalls.push(chunk.toString());
        callback();
      },
    });
    writer = new JSONStdinWriter(mockWritable);
  });

  it("should serialize and write messages correctly", () => {
    const message = { type: "test", data: "hello" };
    const result = writer.write(message);

    expect(result).toBe(true);
    expect(writeCalls).toHaveLength(1);
    expect(JSON.parse(writeCalls[0])).toEqual(message);
    expect((writeCalls[0] as string)).toMatch(/\n$/);
  });

  it("should write complex nested objects", () => {
    const message = {
      type: "complex",
      nested: {
        array: [1, 2, 3],
        obj: { key: "value" },
      },
    };
    writer.write(message);

    expect(JSON.parse(writeCalls[0])).toEqual(message);
  });

  it("should handle writing multiple messages", () => {
    const messages = [
      { type: "msg1", id: 1 },
      { type: "msg2", id: 2 },
      { type: "msg3", id: 3 },
    ];

    messages.forEach((msg) => writer.write(msg));

    expect(writeCalls).toHaveLength(3);
    messages.forEach((msg, idx) => {
      expect(JSON.parse(writeCalls[idx])).toEqual(msg);
    });
  });

  it("should return false on write error", () => {
    mockWritable.destroy(new Error("Write error"));
    const result = writer.write({ type: "test" });

    expect(result).toBe(false);
  });
});

describe("JSONStdoutReader", () => {
  let mockReadable: Readable | null;
  let reader: JSONStdoutReader | null;
  let messages: any[] = [];
  let errors: Error[] = [];

  beforeEach(() => {
    messages = [];
    errors = [];
    mockReadable = new Readable({ read: () => {} });
    reader = new JSONStdoutReader(mockReadable);

    reader.on("message", (msg) => messages.push(msg));
    reader.on("error", (err) => errors.push(err));
  });

  it("should parse newline-delimited JSON messages", async () => {
    const input = JSON.stringify({ type: "msg1" }) + "\n" +
                  JSON.stringify({ type: "msg2" }) + "\n";

    mockReadable!.push(input);
    await new Promise((r) => setTimeout(r, 10));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: "msg1" });
    expect(messages[1]).toEqual({ type: "msg2" });
  });

  it("should handle partial reads and buffer accumulation", async () => {
    const part1String = JSON.stringify({ type: "part1" });
    const chunk1 = part1String.substring(0, 10);
    const chunk2 = part1String.substring(10) + "\n";
    const chunk3 = JSON.stringify({ type: "part2" }) + "\n";

    messages = [];

    mockReadable!.push(chunk1);
    await new Promise((r) => setTimeout(r, 10));

    mockReadable!.push(chunk2);
    await new Promise((r) => setTimeout(r, 10));

    mockReadable!.push(chunk3);
    await new Promise((r) => setTimeout(r, 10));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: "part1" });
    expect(messages[1]).toEqual({ type: "part2" });
  });

  it("should skip empty lines", async () => {
    const input = JSON.stringify({ type: "msg1" }) + "\n\n\n" +
                  JSON.stringify({ type: "msg2" }) + "\n";

    mockReadable!.push(input);
    await new Promise((r) => setTimeout(r, 10));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: "msg1" });
    expect(messages[1]).toEqual({ type: "msg2" });
  });

  it("should emit error on invalid JSON", async () => {
    messages = [];
    errors = [];

    const input = "invalid json\n" + JSON.stringify({ type: "valid" }) + "\n";

    mockReadable!.push(input);
    await new Promise((r) => setTimeout(r, 10));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "valid" });
  });

  it("should handle messages with whitespace", async () => {
    messages = [];

    const input = "  " + JSON.stringify({ type: "msg1" }) + "  \n" +
                  "\t" + JSON.stringify({ type: "msg2" }) + "\t\n";

    mockReadable!.push(input);
    await new Promise((r) => setTimeout(r, 10));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: "msg1" });
    expect(messages[1]).toEqual({ type: "msg2" });
  });
});
