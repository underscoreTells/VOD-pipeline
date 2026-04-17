const isDebugEnabled =
  process.env.NODE_ENV !== 'production' || process.env.VOD_PIPELINE_DEBUG === 'true';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function writeLog(scope: string, level: LogLevel, args: unknown[]): void {
  if (level === 'debug' && !isDebugEnabled) {
    return;
  }

  const prefix = `[${scope}]`;
  const writer =
    level === 'error' ? console.error :
    level === 'warn' ? console.warn :
    console.log;

  writer(prefix, ...args);
}

export function createLogger(scope: string) {
  return {
    debug: (...args: unknown[]) => writeLog(scope, 'debug', args),
    info: (...args: unknown[]) => writeLog(scope, 'info', args),
    warn: (...args: unknown[]) => writeLog(scope, 'warn', args),
    error: (...args: unknown[]) => writeLog(scope, 'error', args),
  };
}
