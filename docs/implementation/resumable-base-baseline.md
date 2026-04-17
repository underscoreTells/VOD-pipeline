# Resumable Base Baseline

## Branch Snapshot

- Cleanup branch: `refactor/resumable-base`
- Cleanup base commit: `4b840ae1120782b9cf490cdbe5d1a18a90d8dfc3`
- Archived dirty branch: `archive/timeline-hotkeys-context-menu-wip-2026-04-16`
- Archive commit: `0c68bd5`

## Archived Dirty File List

The pre-refactor dirty state was checkpointed from `feature/timeline-hotkeys-context-menu` with these changes:

- `src/agent/graphs/main-orchestrator.ts`
- `src/agent/index.ts`
- `src/electron/database/db.ts`
- `src/electron/ipc/handlers.ts`
- `src/electron/preload.d.ts`
- `src/electron/preload.ts`
- `src/renderer/lib/components/ChapterDefinition.svelte`
- `src/renderer/lib/components/ChatPanel.svelte`
- `src/renderer/lib/components/ProjectDetail.svelte`
- `src/renderer/lib/state/agent.svelte.ts`
- `src/renderer/lib/state/chapters.svelte.ts`
- `src/renderer/lib/state/electron.svelte.ts`
- `tests/integration/chapter-update.test.ts`
- `tests/unit/suggestion-to-clip.test.ts`
- `src/shared/constants/chapter-limits.ts`
- `src/shared/utils/assistant-message.ts`
- `tests/unit/assistant-message.test.ts`

## Health Snapshot Before Refactor

- `svelte-check` passed with `0 errors` and `0 warnings`.
- The Vitest suite was not green.
- The shell environment did not have `pnpm` or `corepack` on `PATH`.
- The repo depended on tracked emitted files under `src/**`.
- The local shell was running Node `25.x`, which caused `better-sqlite3` ABI mismatch failures against dependencies installed for Node `22.x`.

## Failing or Untrustworthy Tests

- `tests/integration/agent-spawn.test.ts`
  - Used `throw new Error("SKIP")` instead of real skip semantics.
  - Targeted `build/src/agent/index.js` instead of `dist/src/agent/index.js`.
- `tests/unit/json-message-transport.test.ts`
  - Expected an emitted error for invalid NDJSON lines, but `JSONStdoutReader` silently ignored malformed lines.
- `tests/integration/timeline/waveform-generation.test.ts`
  - Assumed waveform generation returned data instead of `null` when `audiowaveform` was unavailable.
  - Imported helpers that were not actually exported from the database boundary.
  - Expected different zoom thresholds than the current implementation.
- `tests/integration/chapter-update.test.ts`
- `tests/integration/clip-create-from-selection.test.ts`
- `tests/unit/suggestion-to-clip.test.ts`
  - All failed in this shell because `better-sqlite3` had been built for a different Node ABI.

## Missing-Tool Behavior Before Refactor

- Missing `pnpm`: documented workflow could not be executed directly.
- Missing `corepack`: no built-in fallback bootstrap path was documented.
- Missing `audiowaveform`: waveform functions returned `null` and several tests crashed on that return shape.
- Missing built agent output: agent integration tests failed instead of skipping cleanly.

## Known Stale or Incorrect Docs

- `README.md` referenced `docs/phase-1-3-plan.md`, which did not exist.
- `README.md` assumed `pnpm` was already installed.
- The documented workflow did not describe a doctor or verify step.
- `PLAN.md` described the target architecture more than the currently implemented state.

## Cleanup Scope Frozen For This Refactor

- Electron bootstrap and logging
- IPC registration and handler boundaries
- Database initialization, migrations, and repository boundaries
- Waveform pipeline contracts
- Agent transport contracts
- Renderer orchestration state
- Build and test scripts
- Current-state and maintenance documentation
