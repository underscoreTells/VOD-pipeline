# VOD Pipeline - AI-Assisted Video Editor

## Project Overview

An Electron desktop application that transforms Twitch VODs into cohesive YouTube long-form videos (DougDoug/Ludwig/PointCrow style). Features an AI agent that helps convert raw livestreams into rough cuts with essential narrative beats identified and non-destructive exports to professional NLEs.

**See @PLAN.md for detailed implementation plan including database schema, folder structure, IPC protocol, and development phases.**

**See @docs/phase-1-3-plan.md for detailed task breakdown of phases 1-3 with specific implementation details.**

## Tech Stack

- **Desktop**: Electron + TypeScript
- **UI**: Svelte 5 + TypeScript (runes API, .svelte.ts state files)
- **Package Manager**: pnpm
- **Agent System**: LangChain + LangGraph (multi-agent subgraphs with orchestrator-worker pattern)
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
- **Agent Worker Process** (child_process): LangChain + LangGraph, multi-agent orchestration
- **Renderer Process** (Svelte 5): Chat UI, timeline visualization, project management

### Core Modules

1. **Electron App Shell** (`src/electron/`)
   - Main process, window management
   - IPC communication between renderer and main processes
   - Database operations (SQLite)
   - FFmpeg/Whisper orchestration
   - Spawns agent child process

2. **Agent System** (`src/agent/`)
   - LangChain + LangGraph multi-agent system
   - Pluggable LLM provider architecture (Gemini, OpenAI, Anthropic)
   - Main orchestrator graph with chapter subgraphs
   - Prompt templates for narrative analysis
   - Context management (transcripts, chat logs, video metadata)
   - Streaming via custom writer + messages modes

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
   - Phase 1: Conversational setup - user chats with agent, feeds chapter transcripts/summaries, describes vision for finished video
   - Phase 2: Parallel chapter analysis - main agent spawns one sub-agent per chapter (via LangGraph Send API), each gets transcript + video + instructions from main agent
   - Phase 3: Story cohesion meta-pass - main agent reviews all chapter analyses, identifies through-lines/callbacks, recommends chapter ordering
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

The agent acts as a senior video editor assistant:

- **Narrative Analysis**: Identifies story arcs, turning points, setup→payoff dependencies
- **Beat Extraction**: Finds essential moments (setup, escalation, twist, payoff, transition)
- **Fluff Detection**: Identifies repetitive sections, dead air, off-topic content
- **Visual Verification**: Confirms visual events and tightens cut points when needed
- **Story Cohesion**: Recommends chapter order, callbacks, through-lines
- **Conversational Interface**: Responds to requests like "make this more engaging," "find the payoff to this setup," "what can I cut?"

## Export Formats

- **XML**: FCPXML format for Final Cut Pro and DaVinci Resolve
- **EDL**: Edit Decision List for Premiere Pro, DaVinci Resolve, Avid
- **AAF**: Advanced Authoring Format (if feasible, otherwise fallback to EDL)
- All exports preserve original media references and allow non-destructive editing in professional NLEs

## Project Phases

1. **Core Infrastructure** - Electron app, FFmpeg wrapper, Whisper integration, SQLite schemas
2. **Chapter Management** - Manual chapter selection, transcription, project persistence
3. **AI Agent Foundation** - LLM provider abstraction, prompt templates, basic chat interface
4. **Beat Extraction** - Per-chapter analysis, essential vs optional identification
5. **Story Cohesion** - Meta-pass across chapters, narrative glue
6. **NLE Exports** - XML/EDL generation, timeline reconstruction
7. **UI Refinement** - Timeline visualization, clip management, project browser
8. **Optimization** - Local/cloud toggle, cost monitoring, performance tuning

## Notes

- Personal software project - no shipping deadlines, focus on quality and usability
- Prioritize Google Gemini for video understanding due to superior multimodal capabilities
- Whisper local transcription preferred for privacy and cost; cloud option available
- All processing runs locally to respect the user's hardware and API key budget
