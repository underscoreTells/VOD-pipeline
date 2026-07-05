# Current State Architecture

This document describes the implemented architecture after the backend/agent refactor (branch `refactor/backend-agent`). It is the current-state counterpart to `PLAN.md`, which remains the forward-looking roadmap.

## Runtime Layout

- Electron main process owns:
  - app bootstrap
  - database lifecycle
  - IPC registration
  - external dependency detection
  - agent worker lifecycle
- Renderer process owns:
  - Svelte 5 UI
  - state orchestration
  - preload-backed API calls
- Agent worker owns:
  - conversation turn orchestration
  - provider selection
  - streaming NDJSON transport
  - tool execution and tool-state streaming

## Agent Runtime

- The implemented agent path is `chat -> runConversationTurn(...) -> turn_complete`.
- The worker does not implement a separate `analyze-chapters` request flow.
- The worker does not use LangGraph or a checkpointer today.
- The runtime prompt surface is split between:
  - `src/agent/conversation/context-builder.ts`
    - `buildConversationSystemPrompt()` builds the canonical system prompt from chapter, clip, transcript, and proposal context.
  - `src/agent/conversation/tools/`
    - one module per tool (`video-evidence.ts`, `transcript-windows.ts`, `proposals.ts`, `finalize.ts`) assembled by `create-tools.ts`
    - `buildVideoEvidencePrompt()` (in `tools/video-evidence.ts`) is the canonical tool-scoped evidence prompt for visual inspection
- The live tool loop is responsible for:
  - gathering transcript and video evidence
  - drafting rough-cut proposals
  - finalizing the assistant response
- Streaming: the user-facing reply is delivered through the `finalizeConversationTurn` tool call. `src/agent/conversation/streaming.ts` incrementally decodes the `assistantResponse` argument from streamed tool-call chunks and forwards live text deltas; providers without native streaming fall back to post-hoc chunking.
- Model steps retry transient errors (429/5xx/network) with exponential backoff via `withLLMRetry`; retries stop once reply text has reached the renderer.
- Tunable loop limits live in `src/agent/constants.ts`.

## LLM Provider Registry

- `src/shared/llm/provider-registry.ts` is the single source of truth for provider ids, labels, env vars, API-key prefixes, default models/aliases, context token limits, and capability flags (`supportsVideo`, `nativeStreaming`). It is renderer-safe (no Node/LangChain imports).
- `src/agent/providers/registry.ts` holds the Node-only runtime: chat model factories and per-provider tool-call strategies.
- Adding a provider requires: one metadata entry (shared registry), one runtime entry (agent registry), and one Settings API-key field mapping (`src/renderer/lib/state/settings-helpers.ts` `PROVIDER_KEY_MAP`). Everything else derives from the registry.

## Prompt Map

- System prompt source: `src/agent/conversation/context-builder.ts`
- Tool prompt source: `src/agent/conversation/tools/`
- Active prompt modules under `src/agent/prompts/`: none
- Active `analyze-chapters` workflow: none

## Key Module Boundaries

- Electron bootstrap is split across:
  - `src/electron/bootstrap/env.ts`
  - `src/electron/bootstrap/window.ts`
  - `src/electron/bootstrap/dependencies.ts`
  - `src/electron/bootstrap/agent-runtime.ts`
  - `src/electron/bootstrap/app-lifecycle.ts`
- IPC entrypoints now flow through `src/electron/ipc/register.ts`, with extracted handler modules for:
  - projects
  - assets
  - chapters
  - clips
  - timeline state
  - transcription
  - waveforms
  - suggestions
  - exports
  - settings
  - dialog
  - agent (split per concern under `src/electron/ipc/handlers/agent/`)
- Request payloads for the simpler handler groups are validated with zod schemas in `src/electron/ipc/schemas.ts`.
- Shared handler support lives in focused modules under `src/electron/ipc/support/` (payload parsing, token guard, conversation results, transcripts, chapter proxies, reverse proxies, heavy-media queue, agent context); `handler-support.ts` is a thin re-export barrel.
- Proxy/media path conventions are centralized in `src/electron/paths.ts`.
- Heavy media jobs (proxy generation, transcription) run through the queue in `src/electron/ipc/support/heavy-media-queue.ts` and are cancellable: each job owns an `AbortController`, the signal is threaded through the ffmpeg/whisper spawn wrappers, and `transcribe:cancel` / `chapter:proxy-cancel` IPC channels expose cancellation to the renderer.
- Database imports should target `src/electron/database/index.ts` or the grouped repository modules under `src/electron/database/repositories/`.
- Multi-table suggestion writes (preview/apply/cancel) run inside transactions via `withTransaction` in `src/electron/database/client.ts`; mid-write failures roll back atomically.
- The database schema revision is recorded in SQLite `user_version` (`CURRENT_SCHEMA_VERSION` in `src/electron/database/migrations.ts`).
- Renderer-side Electron calls should target `src/renderer/lib/api/` wrappers instead of reaching into `window.electronAPI` from large state files.
- Renderer orchestration is split so the public facades stay stable while the implementation lives in narrower modules such as:
  - `src/renderer/lib/state/project-media.svelte.ts`
  - `src/renderer/lib/state/project-waveforms.svelte.ts`
  - `src/renderer/lib/state/project-exports.svelte.ts`
  - `src/renderer/lib/state/clip-auto-name.svelte.ts`
  - `src/renderer/lib/state/agent-session.svelte.ts`
  - `src/renderer/lib/state/agent-proposals.svelte.ts`
  - `src/renderer/lib/state/agent-streaming.svelte.ts`

## Verification Workflow

- `pnpm doctor` validates the local Node/pnpm/native-module baseline and reports optional media dependencies.
- `pnpm typecheck` checks both the renderer (`svelte-check`) and the backend (`tsc -p tsconfig.electron.json --noEmit`).
- `pnpm verify` runs lint, typecheck, and unit tests.
- `pnpm test:integration` is reserved for integration coverage with explicit prerequisite gating.

## Source Of Truth Rules

- Generated runtime artifacts belong in `dist/`, not `src/`.
- `database/schema.sql` is the bootstrap schema for new databases.
- Incremental schema changes are tracked through database migration code, not ad hoc emitted source artifacts.
- `src/electron/database/db.ts` remains a transitional legacy implementation behind newer repository entrypoints; new callers should prefer `src/electron/database/index.ts` and `src/electron/database/repositories/`.
- IPC handlers are split under `src/electron/ipc/handlers/` and registered through `src/electron/ipc/register.ts`; there is no current monolithic `src/electron/ipc/handlers.ts`.
