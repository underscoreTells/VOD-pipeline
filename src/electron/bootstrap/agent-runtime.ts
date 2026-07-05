import type { BrowserWindow } from 'electron';
import { getAgentBridge } from '../agent-bridge.js';
import { createLogger } from '../logger.js';
import { IPC_CHANNELS } from '../ipc/channels.js';
import type { AgentStreamEvent } from '../../shared/types/agent-ipc.js';
import { PROVIDER_IDS, PROVIDER_METADATA } from '../../shared/llm/provider-registry.js';

const logger = createLogger('AgentRuntime');

let agentBridge: ReturnType<typeof getAgentBridge> | null = null;

export async function startAgentRuntime(getWindow: () => BrowserWindow | null): Promise<void> {
  try {
    if (!hasAgentKeys()) {
      logger.info('No API keys found in environment. Agent will rely on Settings-provided keys.');
    }

    logger.info('Starting agent bridge...');
    agentBridge = getAgentBridge();

    agentBridge.on('stream', (message: AgentStreamEvent) => {
      getWindow()?.webContents.send(IPC_CHANNELS.AGENT_STREAM, message);
    });

    agentBridge.on('error', (error: Error) => {
      logger.error('Agent bridge error:', error);
      getWindow()?.webContents.send(IPC_CHANNELS.AGENT_ERROR, { error: error.message });
    });

    agentBridge.on('exit', (code: number, signal: string) => {
      logger.info(`Agent bridge exited: ${code} (${signal})`);
    });

    await agentBridge.ensureStarted();
    logger.info('Agent bridge started successfully');
  } catch (error) {
    logger.error('Failed to start agent bridge:', error);
  }
}

export async function stopAgentRuntime(): Promise<void> {
  if (!agentBridge) {
    return;
  }

  logger.info('Stopping agent bridge...');
  await agentBridge.stop();
  agentBridge = null;
}

function hasAgentKeys(): boolean {
  return PROVIDER_IDS.some((id) => Boolean(process.env[PROVIDER_METADATA[id].envVar]));
}
