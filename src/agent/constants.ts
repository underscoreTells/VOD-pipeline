/** Maximum number of loop steps in a single conversation turn before giving up. */
export const MAX_LOOP_STEPS = 24;

/** Maximum tool calls processed per conversation step. */
export const MAX_TOOL_CALLS_PER_STEP = 4;

/** Maximum structured-repair attempts when the model fails to finalize or hits protocol errors. */
export const MAX_STRUCTURED_REPAIRS = 1;

/** Maximum number of repeated identical tool calls before the runner intervenes. */
export const MAX_REPEATED_TOOL_CALLS = 2;

/** Maximum number of characters of transcript context embedded in a video evidence prompt. */
export const TRANSCRIPT_CONTEXT_MAX_CHARS = 24000;

/** Maximum accepted base64-encoded video size (in bytes) for the Gemini provider. */
export const GEMINI_MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

/** Maximum accepted base64-encoded video size (in bytes) for the Kimi provider. */
export const KIMI_MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
