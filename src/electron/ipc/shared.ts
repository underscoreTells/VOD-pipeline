import type { IPCFailure, IPCResult, IPCSuccess } from '../../shared/contracts/ipc.js';
import { createLogger } from '../logger.js';
import { IPC_ERROR_CODES, type IPCErrorCode } from './channels.js';

const logger = createLogger('IPC');

export function createErrorResponse(
  error: unknown,
  code: IPCErrorCode = IPC_ERROR_CODES.UNKNOWN_ERROR
): IPCFailure & { code: IPCErrorCode } {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${code}: ${message}`, error);

  return {
    success: false,
    error: message,
    code,
  };
}

export function createSuccessResponse<T>(data: T): IPCSuccess<T> {
  return {
    success: true,
    data,
  };
}

export type IPCHandlerResult<T> = IPCResult<T>;
