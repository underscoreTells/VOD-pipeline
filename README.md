# VOD Pipeline

An Electron desktop app for turning long Twitch VODs into structured, local-first editing projects with AI-assisted rough-cut planning.

## Current scope

- Imports projects, chapters, and media into a local SQLite-backed workspace
- Generates or tracks transcription and waveform data through local tooling
- Provides a chapter-aware chat workflow for discussing edits with an AI agent
- Lets the agent gather transcript and video evidence before drafting rough-cut proposals
- Supports timeline state, clip management, and export plumbing for downstream NLE workflows

## Tech stack

- **Desktop:** Electron + TypeScript
- **UI:** Svelte 5 + TypeScript (runes-based state)
- **Agent runtime:** Tool-driven conversation runner with streaming IPC
- **Database:** SQLite
- **Video tooling:** FFmpeg + audiowaveform
- **Testing:** Vitest
- **Package manager:** pnpm

## Getting started

### Prerequisites

- Node.js 22.x
- pnpm 10.26.0

### Install dependencies

```bash
npm install -g pnpm@10.26.0
pnpm install
pnpm doctor
```

### Run in development

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

### Package the app

```bash
pnpm dist
```

## Useful scripts

```bash
pnpm doctor         # Validate local toolchain and optional media dependencies
pnpm verify         # Lint + typecheck + unit tests
pnpm lint           # ESLint
pnpm typecheck      # Svelte + TypeScript checks
pnpm test           # Run unit tests
pnpm test:integration # Run integration tests when prerequisites are available
pnpm test:all       # Run all Vitest suites
pnpm test:ui        # Open the Vitest UI
pnpm test:coverage  # Coverage report
pnpm dist           # Build distributable Electron package
```

## Project layout

- `src/electron/` - Electron main process, bootstrap, IPC handlers, database access, and native-tool orchestration
- `src/renderer/` - Svelte UI, state modules, timeline/editor interactions, and preload-backed API wrappers
- `src/agent/` - conversation runner, provider adapters, tool runtime, and worker-side streaming transport
- `src/pipeline/` - FFmpeg, Whisper, waveform, and export helpers
- `src/shared/` - shared contracts, types, and utilities used across processes
- `database/` - bootstrap schema and migration assets
- `scripts/` - development bootstrap, native dependency setup, and local diagnostics
- `tests/` - unit and integration coverage
- `docs/` - architecture notes, implementation plans, maintenance docs, and research

## Documentation

- `PLAN.md` - forward-looking architecture and roadmap
- `docs/architecture/current-state.md` - current implemented architecture and module boundaries
- `docs/WORKFLOW.md` - development workflow notes
- `docs/implementation/` - targeted implementation plans for active cleanup and fixes
- `docs/maintenance/` - maintenance notes for completed refactors
- `docs/research/` - background research for timeline, exports, LangGraph, Whisper, and media tooling
- `docs/archive/` - older phase-by-phase planning documents retained for reference

## Status

This is a personal project and the codebase is still pretty loose.

The current app works in spots, but a lot of it is still held together by AI-generated code, half-finished refactors, and whatever seemed like a good idea at the time. Expect weird edges, brittle assumptions, and the occasional "why does this even work" moment.

The live agent runtime is the chapter-aware conversation loop in `docs/architecture/current-state.md`. It does single-turn tool calls, transcript/video evidence gathering, and streamed responses. `PLAN.md` is mostly the "maybe someday" document, not a description of what is actually running right now.
