# VOD Pipeline - AI-Assisted Video Editor

## Project Overview

An Electron desktop application that transforms Twitch VODs into cohesive YouTube long-form videos (DougDoug/Ludwig/PointCrow style). Features an AI agent that helps convert raw livestreams into rough cuts with essential narrative beats identified and non-destructive exports to professional NLEs.

**See @PLAN.md for the forward-looking implementation roadmap including database schema, folder structure, IPC protocol, and development phases.**

**See @docs/archive/phase-1-plan.md, @docs/archive/phase-2-plan.md, @docs/archive/phase-3a-plan.md, and @docs/archive/phase-3b-plan.md for archived phase breakdowns.**

## Agent Operating Model

GPT-5.6 sol is the primary orchestrator for work in this repository. Use subagents as much as practical to reduce cost, parallelize independent work, and keep the primary context focused.

- Default to delegating codebase exploration, broad searches, research, test discovery, log analysis, and other well-bounded investigations to subagents.
- Launch independent subagent tasks in parallel when their work does not overlap.
- Give each subagent a precise scope, relevant context, expected output, and verification criteria.
- Do not duplicate work already delegated. Continue with non-overlapping work or wait for the result.
- Treat subagent output as evidence, not final authority. GPT-5.6 sol is more capable than its subagents and remains responsible for checking important claims, resolving conflicts, and integrating findings into a coherent solution.
- Keep high-impact, high-value, high-risk, security-sensitive, architecture-defining, data-loss-sensitive, and cross-cutting decisions under GPT-5.6 sol's direct control.
- GPT-5.6 sol should personally inspect the critical code paths before editing them, even when a subagent mapped those paths first.
- Delegate implementation only when the task is isolated and the ownership boundary is clear. GPT-5.6 sol must review delegated changes before accepting them.
- Do not use subagents merely to avoid difficult reasoning. The orchestrator owns root-cause analysis, tradeoff decisions, the final implementation strategy, and the final answer.
- The orchestrator owns end-to-end verification. Subagents may run focused checks, but GPT-5.6 sol must ensure the combined change is tested appropriately and satisfies the user's request.
- Prefer the smallest number of focused subagents that provides meaningful parallelism. Avoid fragmentation, redundant agents, and coordination overhead for trivial work.

## Tech Stack

- **Desktop**: Electron + TypeScript
- **UI**: Svelte 5 + TypeScript (runes API, .svelte.ts state files)
- **Package Manager**: pnpm
- **Agent System**: Current runtime uses a tool-driven conversation runner; LangGraph multi-agent subgraphs remain roadmap work
- **Database**: SQLite (local project storage)
- **Video Processing**: FFmpeg (local execution via child_process)
- **Transcription**: Whisper (local via faster-whisper, or cloud alternative)
- **AI Providers**: Primary: Google Gemini (best video understanding), Secondary: OpenAI, Anthropic (pluggable architecture)
- **NLE Exports**: XML (Final Cut Pro), EDL (DaVinci/Premiere), AAF (Avid)

## Development Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm dev

# Build
pnpm build

# Lint
pnpm lint

# Type check
pnpm typecheck
```

## Code Conventions

- TypeScript strict mode enabled
- Svelte 5 runes API (`$state`, `$derived`, `$props`, `$effect`) for state management
- State sharing via `.svelte.ts` files (not stores)
- Error handling: Async/await with try/catch, proper error logging
- File naming: camelCase for TS files, PascalCase for Svelte components
- Import ordering: External libraries → Internal modules → Type imports

## Architecture Overview

### Process Architecture

Three-process design:
- **Main Process** (Electron): App shell, database, FFmpeg/Whisper orchestration, IPC bridge
- **Agent Worker Process** (child_process): tool-driven conversation runner
  - Current implementation: single-turn conversation loop with provider-native tool calls and streaming IPC
  - Roadmap: graph orchestration remains deferred design work in `PLAN.md`
- **Renderer Process** (Svelte 5): Chat UI, timeline visualization, project management

### Core Modules

1. **Electron App Shell** (`src/electron/`)
   - Main process, window management
   - IPC communication between renderer and main processes
   - Database operations (SQLite)
   - FFmpeg/Whisper orchestration
   - Spawns agent child process

2. **Agent System** (`src/agent/`)
  - Current runtime: tool-driven conversation runner
  - Central provider registry: `src/shared/llm/provider-registry.ts` (metadata, renderer-safe) + `src/agent/providers/registry.ts` (model factories/tool strategies). Adding a provider = one entry in each + a Settings key mapping.
  - Providers: Gemini, OpenAI, Anthropic, OpenRouter, Kimi (Moonshot)
  - Dynamic system prompt plus tool-specific evidence prompts (`src/agent/conversation/tools/`)
  - LangGraph orchestrator/subgraph design is roadmap-only, not wired into the current worker
  - Context management (transcripts, chat logs, proposal summaries)
  - True token streaming of the final reply (incremental tool-argument decoding in `src/agent/conversation/streaming.ts`) with transient-error retry; tool-state messages stream via a custom writer

3. **Svelte 5 UI** (`src/renderer/`)
   - Chat interface (agent interaction)
   - Timeline/clip visualization
   - Project management
   - Settings and API key management
   - State with `.svelte.ts` files (runes API)

4. **Video Processing Pipeline** (`src/pipeline/`)
   - FFmpeg wrapper for video operations (cuts, proxies, exports)
   - Whisper integration for transcription (local/cloud toggle)
   - NLE export generation (XML/EDL/AAF)

5. **Database Schema** (`database/`)
   - SQLite schema for projects, assets, chapters, transcripts, beats, conversations
   - CRUD operations for video projects
   - State persistence and recovery

6. **Shared Types** (`src/shared/`)
   - Common TypeScript types across processes
   - IPC message type definitions

### Data Flow

1. **Import**: User drops assets into new project (full VOD or pre-cut chapters, or both)
2. **Transcription**: Whisper runs in background (local or cloud), auto-added to project
3. **AI Analysis**:
   - Phase 0: Asset import and transcription (background job)
   - Current runtime: conversational chapter editing with context-aware prompts, transcript evidence, video evidence, and proposal drafting
   - Roadmap Phase 1: conversational setup - user chats with agent, feeds chapter transcripts/summaries, describes vision for finished video
   - Roadmap Phase 2: parallel chapter analysis - main agent spawns one sub-agent per chapter (via LangGraph Send API), each gets transcript + video + instructions from main agent
   - Roadmap Phase 3: story cohesion meta-pass - main agent reviews all chapter analyses, identifies through-lines/callbacks, recommends chapter ordering
4. **Exports**: Generate XML/EDL/AAF for DaVinci Resolve/Premiere/FCP
5. **Refinement**: User adjusts cuts in professional NLE → Final export

### Key Design Decisions

- **Local-first**: Heavy video processing runs locally to avoid uploading multi-hour VODs
- **Hybrid AI**: Use LLM text APIs for narrative analysis (cheap), video understanding only where needed (visual events)
- **Cost control**: Batch processing, low-res proxies for analysis, targeted high-res verification
- **Non-destructive**: Original VOD never modified; all operations work with references/timestamps
- **BYOK Support**: User provides own API keys for cloud services; local options available
- **Pluggable Providers**: Different AI models can be swapped via configuration
- **Database at root**: SQLite database sits at project root (not in src/)
- **Three-process architecture**: Main ↔ Agent (child_process) ↔ Renderer, with streaming via IPC

## AI Agent Capabilities

The current runtime agent acts as a senior video editor assistant:

- **Chapter Conversation**: Responds to editing requests using chapter transcript and timeline context
- **Evidence Gathering**: Loads detailed transcript windows and optional video evidence before making claims
- **Proposal Drafting**: Produces structured rough-cut suggestions and timeline actions
- **Conversational Interface**: Responds to requests like "make this more engaging," "find the payoff to this setup," "what can I cut?"

## Export Formats

- **XML**: FCPXML format for Final Cut Pro and DaVinci Resolve
- **EDL**: Edit Decision List for Premiere Pro, DaVinci Resolve, Avid
- **AAF**: Advanced Authoring Format (if feasible, otherwise fallback to EDL)
- All exports preserve original media references and allow non-destructive editing in professional NLEs

## Project Phases

1. **Core Infrastructure** - Electron app, FFmpeg wrapper, Whisper integration, SQLite schemas
2. **Chapter Management** - Manual chapter selection, transcription, project persistence
3. **AI Agent Foundation** - LLM provider abstraction, prompt-driven chat interface, evidence tools
4. **Beat Extraction** - Roadmap: per-chapter analysis, essential vs optional identification
5. **Story Cohesion** - Roadmap: meta-pass across chapters, narrative glue
6. **NLE Exports** - XML/EDL generation, timeline reconstruction
7. **UI Refinement** - Timeline visualization, clip management, project browser
8. **Optimization** - Local/cloud toggle, cost monitoring, performance tuning

## Notes

- Personal software project - no shipping deadlines, focus on quality and usability
- Prioritize Google Gemini for video understanding due to superior multimodal capabilities
- Whisper local transcription preferred for privacy and cost; cloud option available
- All processing runs locally to respect the user's hardware and API key budget
