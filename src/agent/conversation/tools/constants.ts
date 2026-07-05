export const MAX_VIDEO_OBSERVATIONS = 12;
export const MAX_PROPOSAL_DRAFTS = 16;
export const MAX_TRANSCRIPT_WINDOW_REQUESTS = 3;
export const CLIP_ROLE_VALUES = ["setup", "escalation", "twist", "payoff", "transition"] as const;
export const TURN_OUTCOME_VALUES = ["discussion", "proposal", "clarification"] as const;
export const PLAYHEAD_GROUNDING_WINDOW_SECONDS = 45;
export const KEEP_WINDOW_REMOVAL_PREFIX = /^\s*(cut|remove|trim|drop|skip|omit|delete)\b/i;
