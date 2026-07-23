import { getAgentBridge } from '../../../agent-bridge.js';
import { IPC_CHANNELS } from '../../channels.js';
import { registerAgentApplyActionsHandler } from './apply-actions.js';
import { registerAgentBranchHandler } from './branch.js';
import { registerAgentCancelHandler } from './cancel.js';
import { registerAgentChatHandler } from './chat.js';
import { registerAgentConversationHandlers } from './conversations.js';
import { registerAgentEditHandler } from './edit.js';
import { registerAgentGroundingHandler } from './grounding.js';
import { registerAgentRerollHandler } from './reroll.js';

export const AGENT_HANDLER_CHANNELS = [
  IPC_CHANNELS.AGENT_CONVERSATION_CREATE,
  IPC_CHANNELS.AGENT_CONVERSATION_LIST,
  IPC_CHANNELS.AGENT_CONVERSATION_MESSAGES,
  IPC_CHANNELS.AGENT_CONVERSATION_DELETE,
  IPC_CHANNELS.AGENT_CONVERSATION_UPDATE,
  IPC_CHANNELS.AGENT_CHAT,
  IPC_CHANNELS.AGENT_CANCEL_TURN,
  IPC_CHANNELS.AGENT_GROUNDING_STATUS,
  IPC_CHANNELS.AGENT_REROLL_MESSAGE,
  IPC_CHANNELS.AGENT_EDIT_MESSAGE,
  IPC_CHANNELS.AGENT_BRANCH_MESSAGE,
  IPC_CHANNELS.AGENT_APPLY_ACTIONS,
];

export function registerAgentHandlers(): void {
  const agentBridge = getAgentBridge();

  registerAgentConversationHandlers();
  registerAgentChatHandler(agentBridge);
  registerAgentCancelHandler(agentBridge);
  registerAgentGroundingHandler();
  registerAgentRerollHandler(agentBridge);
  registerAgentEditHandler(agentBridge);
  registerAgentBranchHandler();
  registerAgentApplyActionsHandler();
}
