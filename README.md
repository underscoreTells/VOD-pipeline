# VOD Pipeline

An Electron desktop app for turning long Twitch VODs into cohesive, long-form YouTube edits with AI-assisted narrative analysis.

## What it does

- Imports full VODs and chapter media into a local-first editing project
- Transcribes content with Whisper tooling
- Uses a multi-agent workflow (LangChain + LangGraph) to identify key beats, cut candidates, and story flow
- Helps prepare non-destructive exports for professional NLE tools (XML/EDL/AAF goals)

## Tech stack

- **Desktop:** Electron + TypeScript
- **UI:** Svelte 5 + TypeScript
- **Agent orchestration:** LangChain + LangGraph
- **Database:** SQLite
- **Video tooling:** FFmpeg + audiowaveform
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

## Useful scripts

```bash
pnpm doctor         # Validate local toolchain and optional media dependencies
pnpm verify         # Lint + typecheck + unit tests
pnpm typecheck      # Svelte + TypeScript checks
pnpm test           # Run unit tests with Vitest
pnpm test:integration
pnpm test:all
pnpm test:coverage  # Coverage report
pnpm dist           # Build distributable Electron package
```

## Project layout

- `src/electron/` – Electron main process, IPC, orchestration
- `src/renderer/` – Svelte renderer UI
- `src/agent/` – AI agent graph, providers, prompts
- `src/pipeline/` – Media pipeline integrations (FFmpeg/Whisper/export)
- `src/shared/` – Shared types and contracts
- `database/` – SQLite schema and migration assets
- `docs/` – Plans, research notes, implementation docs

## Documentation

- `PLAN.md` – architecture and implementation roadmap
- `docs/architecture/current-state.md` – current implemented architecture and boundaries
- `docs/implementation/resumable-base-baseline.md` – baseline snapshot for the resumable-base refactor
- `docs/maintenance/resumable-base.md` – implementation notes for the resumable-base cleanup
- `docs/WORKFLOW.md` – development workflow notes

## Status

This is an active personal project focused on quality and iteration speed, with local-first workflows and pluggable AI providers.
