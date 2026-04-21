import { formatWithOptions } from "node:util";

function writeConsoleMessageToStderr(args: unknown[]): void {
  process.stderr.write(`${formatWithOptions({}, ...args)}\n`);
}

const redirectedConsoleLog: typeof console.log = (...args: Parameters<typeof console.log>) => {
  writeConsoleMessageToStderr(args);
};

const redirectedConsoleInfo: typeof console.info = (...args: Parameters<typeof console.info>) => {
  writeConsoleMessageToStderr(args);
};

export function installStdoutProtocolGuard(): void {
  if (console.log === redirectedConsoleLog && console.info === redirectedConsoleInfo) {
    return;
  }

  console.log = redirectedConsoleLog;
  console.info = redirectedConsoleInfo;
}
