import { ipcMain } from 'electron';
import type { getAgentBridge } from '../../../agent-bridge.js';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../../channels.js';
import { createErrorResponse, createSuccessResponse } from '../../shared.js';

export function registerAgentCancelHandler(
  agentBridge: ReturnType<typeof getAgentBridge>
): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_CANCEL_TURN, async (_, payload) => {
    const clientRequestId = typeof payload?.clientRequestId === 'string'
      ? payload.clientRequestId.trim()
      : '';

    if (!clientRequestId) {
      return createErrorResponse(
        'Client request ID is required',
        IPC_ERROR_CODES.VALIDATION_ERROR
      );
    }

    const cancelled = agentBridge.cancelByClientRequestId(clientRequestId);
    if (!cancelled) {
      return createErrorResponse(
        'The agent turn is no longer running',
        IPC_ERROR_CODES.NOT_FOUND
      );
    }

    return createSuccessResponse({ cancelled: true });
  });
}
