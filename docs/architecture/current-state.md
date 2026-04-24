# Current State Architecture

This document describes the implemented architecture after the resumable-base refactor work lands. It is the current-state counterpart to `PLAN.md`, which remains the forward-looking roadmap.

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
  - `src/agent/conversation/tools.ts`
    - tool contracts define the actionable protocol for the model
    - `buildVideoEvidencePrompt()` is the canonical tool-scoped evidence prompt for visual inspection
- The live tool loop is responsible for:
  - gathering transcript and video evidence
  - drafting rough-cut proposals
  - finalizing the assistant response

## Prompt Map

- System prompt source: `src/agent/conversation/context-builder.ts`
- Tool prompt source: `src/agent/conversation/tools.ts`
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
  - clips
  - timeline state
  - exports
  - settings
- Database imports should target `src/electron/database/index.ts` or the grouped repository modules under `src/electron/database/repositories/`.
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
- `pnpm verify` runs lint, typecheck, and unit tests.
- `pnpm test:integration` is reserved for integration coverage with explicit prerequisite gating.

## Source Of Truth Rules

- Generated runtime artifacts belong in `dist/`, not `src/`.
- `database/schema.sql` is the bootstrap schema for new databases.
- Incremental schema changes are tracked through database migration code, not ad hoc emitted source artifacts.
- `src/electron/database/db.ts` remains a transitional legacy implementation behind newer repository entrypoints; new callers should prefer `src/electron/database/index.ts` and `src/electron/database/repositories/`.
- IPC handlers are split under `src/electron/ipc/handlers/` and registered through `src/electron/ipc/register.ts`; there is no current monolithic `src/electron/ipc/handlers.ts`.
