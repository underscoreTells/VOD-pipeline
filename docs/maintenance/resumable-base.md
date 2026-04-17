# Resumable Base Refactor

This note tracks the cleanup work that turns the current branch into a trustworthy base for future feature work.

## Goals

- Make the documented workflow runnable on a fresh machine.
- Make tests fail for explicit reasons instead of environment accidents.
- Reduce re-entry cost by splitting oversized files into bounded modules.
- Keep UI behavior and persisted data compatible while improving maintainability.

## Implementation Notes

- The dirty pre-refactor worktree was preserved on `archive/timeline-hotkeys-context-menu-wip-2026-04-16`.
- The cleanup work proceeds from `4b840ae1120782b9cf490cdbe5d1a18a90d8dfc3` on `refactor/resumable-base`.
- Milestones are implemented in dependency order: tooling/test contracts first, then bootstrap, IPC/database boundaries, renderer cleanup, and docs.

## Landed Changes

- Toolchain baseline:
  - pinned Node 22.x via `.nvmrc` and `engines.node`
  - pinned `pnpm@10.26.0`
  - added `pnpm doctor`, `pnpm verify`, `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:all`
  - added a real ESLint baseline
- Source-of-truth cleanup:
  - removed checked-in emitted JS/DTS artifacts from `src/`
  - moved preload generation to `dist/src/electron/preload.cjs`
- Contract cleanup:
  - NDJSON transport now emits `parse-error` separately from stream failures
  - waveform generation throws typed `WaveformError` failures instead of collapsing operational errors into `null`
  - integration tests now skip explicitly for missing prerequisites instead of failing with `throw new Error("SKIP")`
- Electron/runtime boundaries:
  - split main-process bootstrap into dedicated bootstrap modules
  - added `src/electron/logger.ts`
  - added `src/electron/ipc/register.ts` plus extracted modular handlers and services for the simplest domains
  - added `src/electron/database/index.ts` plus grouped repository modules
- Renderer boundaries:
  - added `src/renderer/lib/api/` wrappers
  - split project-detail state into media, waveform, export, and auto-name modules
  - split agent state into session, proposal, and streaming modules with a stable facade

## Transitional Areas

- `src/electron/ipc/handlers.ts` is still the legacy implementation for the more complex chapter, transcription, agent, waveform, and suggestion flows.
- `src/electron/database/db.ts` is still the implementation source behind the new database index and repository boundaries.
- Future cleanup should continue by moving the remaining legacy IPC/database logic into the new handler and repository modules rather than adding new code to the legacy files.
