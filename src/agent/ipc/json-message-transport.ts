import { EventEmitter } from "events";
import { AgentStreamParseError } from "../../shared/contracts/ipc.js";

export class JSONStdinWriter {
  private writable: NodeJS.WritableStream;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastStreamError: Error | null = null;

  constructor(writable: NodeJS.WritableStream) {
    this.writable = writable;
    this.writable.on("error", (error) => {
      this.lastStreamError = error instanceof Error ? error : new Error(String(error));
    });
  }

  write(message: any): boolean {
    try {
      const writable = this.writable as NodeJS.WritableStream & {
        destroyed?: boolean;
        writable?: boolean;
        writableEnded?: boolean;
        writableFinished?: boolean;
      };

      if (
        this.lastStreamError ||
        writable.destroyed ||
        writable.writable === false ||
        writable.writableEnded ||
        writable.writableFinished
      ) {
        return false;
      }

      const json = JSON.stringify(message) + "\n";
      return this.writable.write(json);
    } catch (error) {
      console.error("[JSONStdinWriter] Write error:", error);
      return false;
    }
  }

  writeAsync(message: any): Promise<void> {
    const queuedWrite = this.writeQueue.then(() => this.writeWithBackpressure(message));

    // Keep queue alive even if one write fails.
    this.writeQueue = queuedWrite.catch(() => undefined);

    return queuedWrite;
  }

  private writeWithBackpressure(message: any): Promise<void> {
    return new Promise((resolve, reject) => {
      let json: string;
      try {
        json = JSON.stringify(message) + "\n";
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error(String(error))
        );
        return;
      }

      const writable = this.writable as NodeJS.WritableStream & {
        destroyed?: boolean;
        writable?: boolean;
        writableEnded?: boolean;
        writableFinished?: boolean;
      };

      if (
        writable.destroyed ||
        writable.writable === false ||
        writable.writableEnded ||
        writable.writableFinished
      ) {
        reject(new Error("Writable stream is closed"));
        return;
      }

      let waitingForDrain = false;
      let writeCallbackCompleted = false;
      let settled = false;

      const cleanup = () => {
        this.writable.removeListener("error", onError);
        this.writable.removeListener("close", onClose);
        this.writable.removeListener("finish", onFinish);
        this.writable.removeListener("drain", onDrain);
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error(String(error))
        );
      };

      const maybeResolve = () => {
        if (settled || waitingForDrain || !writeCallbackCompleted) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        fail(error);
      };

      const onClose = () => {
        fail(new Error("Writable stream closed"));
      };

      const onFinish = () => {
        fail(new Error("Writable stream finished"));
      };

      const onDrain = () => {
        waitingForDrain = false;
        maybeResolve();
      };

      this.writable.once("error", onError);
      this.writable.once("close", onClose);
      this.writable.once("finish", onFinish);

      try {
        const canWriteMore = this.writable.write(
          json,
          (error?: Error | null) => {
            if (error) {
              fail(error);
              return;
            }

            writeCallbackCompleted = true;
            maybeResolve();
          }
        );

        if (!canWriteMore) {
          waitingForDrain = true;
          this.writable.once("drain", onDrain);
        }
      } catch (error) {
        fail(error);
      }
    });
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
      this.emit("stream-error", error);
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
        this.emit("parse-error", new AgentStreamParseError(line, error));
      }
    }
  }
}
