import { EventEmitter } from "events";

export class JSONStdinWriter {
  private writable: NodeJS.WritableStream;

  constructor(writable: NodeJS.WritableStream) {
    this.writable = writable;
  }

  write(message: any): boolean {
    try {
      const json = JSON.stringify(message) + "\n";
      return this.writable.write(json);
    } catch (error) {
      console.error("[JSONStdinWriter] Write error:", error);
      return false;
    }
  }

  writeSync(message: any): boolean {
    try {
      const json = JSON.stringify(message) + "\n";
      const stream = this.writable as any;
      if (stream.cork && stream.uncork) {
        stream.cork();
      }
      const result = this.writable.write(json);
      if (stream.uncork) {
        stream.uncork();
      }
      return result;
    } catch (error) {
      console.error("[JSONStdinWriter] Write sync error:", error);
      return false;
    }
  }

  end(): void {
    this.writable.end();
  }
}

export class JSONStdoutReader extends EventEmitter {
  private readable: NodeJS.ReadableStream;
  private buffer: string = "";

  constructor(readable: NodeJS.ReadableStream) {
    super();
    this.readable = readable;

    this.readable.on("data", (chunk: Buffer | string) => {
      this.buffer += typeof chunk === "string" ? chunk : chunk.toString();
      this.processBuffer();
    });

    this.readable.on("error", (error: Error) => {
      console.error("[JSONStdoutReader] Stream error:", error);
      this.emit("error", error);
    });

    this.readable.on("close", () => {
      this.emit("close");
    });

    this.readable.on("end", () => {
      this.emit("close");
    });
  }

  private processBuffer(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = this.buffer.substring(0, newlineIndex).trim();
      this.buffer = this.buffer.substring(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      try {
        const message = JSON.parse(line);
        this.emit("message", message);
      } catch (error) {
        console.warn("[JSONStdoutReader] Ignoring non-JSON line:", line);
      }
    }
  }
}
