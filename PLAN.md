# VOD Pipeline - Implementation Plan

## Tech Stack

- **Desktop**: Electron + TypeScript
- **UI**: Svelte 5 + TypeScript (runes API, .svelte.ts state files)
- **Package Manager**: pnpm
- **Agent System**: LangChain + LangGraph (multi-agent subgraphs)
- **Database**: SQLite (local project storage)
- **Video Processing**: FFmpeg (local, via child_process)
- **Transcription**: Whisper (local via faster-whisper, or cloud alternative)
- **LLM Providers**: Primary: Google Gemini (video understanding), Secondary: OpenAI, Anthropic (pluggable)
- **NLE Exports**: XML (FCPXML), EDL, AAF (non-destructive to professional editors)

## Process Architecture

### Three-Process Design

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (Electron)                                    │
│  ─────────────────────────────────────────────────────────  │
│  - App shell (window management)                           │
│  - Database operations (SQLite)                            │
│  - FFmpeg/Whisper orchestration                            │
│  - IPC bridge to renderer (UI communication)               │
│  - Spawns Agent Child Process                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ IPC (chat, stream)
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent Child Process                                       │
│  ─────────────────────────────────────────────────────────  │
│  - LangChain + LangGraph                                    │
│  - Main orchestrator graph                                 │
│  - Chapter subgraphs (spawned in parallel)                 │
│  - LLM API calls (multi-provider)                          │
│  - Streaming responses to main                             │
│  - Audio/video analysis logic                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Renderer Process (Svelte 5)                               │
│  ─────────────────────────────────────────────────────────  │
│  - Chat UI (agent interaction)                             │
│  - Timeline/clip visualization                             │
│  - Project management                                    │
│  - IPC to main process                                    │
│  - State with .svelte.ts files (runes API)                 │
└─────────────────────────────────────────────────────────────┘
```

## Agent Workflow

### Multi-Agent Pattern: Orchestrator-Worker

Main agent (orchestrator) coordinates chapter-specific subagents:

1. **Phase 0: Asset Import**
   - User drops assets into project (full VOD, pre-cut chapters, or mixed)
   - Whisper transcription runs in background (local or cloud)

2. **Phase 1: Conversational Setup**
   - User chats with main agent
   - Feeds chapter transcripts or AI-generated summaries
   - Describes vision for finished video
   - Specifies energy level, keep/reject criteria

3. **Phase 2: Parallel Chapter Analysis**
   - Main agent spawns one sub-agent per chapter (via `new Send()` API)
   - Each sub-agent receives:
     - Chapter transcript
     - Chapter video (for visual verification)
     - Instructions from main agent (based on user's vision)

4. **Phase 3: Story Cohesion (Meta-pass)**
   - Main agent reviews all chapter analyses
   - Identifies through-lines, callbacks
   - Recommends chapter ordering
   - Generates recap suggestions

5. **Phase 4: Export Generation**
   - Generate XML/EDL/AAF for DaVinci/Premiere/FCP
   - Non-destructive (references original media)

## Database Schema

### Projects
```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Assets
```sql
CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  duration REAL,
  metadata JSON,
  FOREIGN KEY (project_id) REFERENCES projects(id)
)
```

### Chapters
```sql
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
)
```

### Chapter Assets (many-to-many)
```sql
CREATE TABLE chapter_assets (
  chapter_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  PRIMARY KEY (chapter_id, asset_id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
)
```

### Transcripts
```sql
CREATE TABLE transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
)
```

### Beats
```sql
CREATE TABLE beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  role TEXT NOT NULL,
  why_essential TEXT,
  visual_dependency TEXT,
  is_essential BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
)
```

### Agent Conversations
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
)
```

## Folder Structure

```
vod-pipeline/
├── src/
│   ├── electron/                    # Electron main process
│   │   ├── main.ts                  # Entry point, window management
│   │   ├── ipc/
│   │   │   ├── handlers.ts          # Main → Renderer IPC handlers
│   │   │   ├── channels.ts          # IPC channel definitions
│   │   │   └── agent-bridge.ts      # Main ↔ Agent child process IPC
│   │   └── database/
│   │       └── db.ts                # SQLite operations
│   │
│   ├── agent/                       # Agent child process
│   │   ├── index.ts                 # Entry point for child process
│   │   ├── graphs/                  # LangGraph definitions
│   │   │   ├── main-orchestrator.ts     # Main coordinator graph
│   │   │   ├── chapter-subgraph.ts      # Per-chapter analysis
│   │   │   └── story-cohesion-graph.ts  # Meta-analysis
│   │   ├── nodes/                   # Node functions (NOT chains)
│   │   │   ├── transcription.ts
│   │   │   ├── narrative-analysis.ts
│   │   │   ├── beat-extraction.ts
│   │   │   ├── visual-verification.ts
│   │   │   └── story-cohesion.ts
│   │   ├── state/                   # State schemas (Zod)
│   │   │   └── schemas.ts
│   │   ├── tools/                   # Custom tools
│   │   │   ├── video/
│   │   │   │   ├── ffmpeg.ts
│   │   │   │   ├── frame-extractor.ts
│   │   │   │   └── proxy-generator.ts
│   │   │   └── transcript/
│   │   │       └── whisper.ts
│   │   ├── prompts/                 # Prompt templates
│   │   │   ├── narrative-analysis.ts
│   │   │   ├── beat-extraction.ts
│   │   │   ├── visual-verification.ts
│   │   │   └── story-cohesion.ts
│   │   ├── providers/               # LLM provider abstractions
│   │   │   ├── base.ts
│   │   │   ├── gemini.ts
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   └── index.ts
│   │   └── utils/                   # Checkpointers, store, helpers
│   │       ├── checkpoints.ts
│   │       └── store.ts
│   │
│   ├── renderer/                    # Svelte 5 UI
│   │   ├── App.svelte               # Root component
│   │   ├── main.ts                  # Entry point
│   │   ├── index.html
│   │   ├── lib/
│   │   │   ├── components/
│   │   │   │   ├── Chat.svelte
│   │   │   │   ├── Timeline.svelte
│   │   │   │   ├── ChapterList.svelte
│   │   │   │   └── ui/              # Reusable UI components
│   │   │   ├── state/               # .svelte.ts files (runes API)
│   │   │   │   ├── project.svelte.ts
│   │   │   │   ├── agent.svelte.ts
│   │   │   │   └── ui.svelte.ts
│   │   │   ├── types/
│   │   │   │   └── index.ts
│   │   │   └── components/          # Barrel exports
│   │   │       └── index.ts
│   │   └── styles/
│   │       └── app.css
│   │
│   ├── pipeline/                    # Video processing (shared tools)
│   │   ├── ffmpeg.ts
│   │   └── whisper.ts
│   │
│   └── shared/                      # Shared types/constants
│       └── types/
│           └── index.ts
│
├── database/                        # Database schema
│   └── schema.sql
│
├── docs/
│   └── research/                    # Research documents
│       ├── langgraph-architecture.md
│       └── svelte-5-architecture.md
│
├── AGENTS.md                        # High-level project reference
├── PLAN.md                          # This file
├── package.json
├── tsconfig.json
├── tsconfig.electron.json
├── tsconfig.renderer.json
├── vite.config.ts
├── svelte.config.js
└── electron-builder.json
```

## IPC Protocol

### Renderer ↔ Main

**Renderer → Main:**
```typescript
// Project operations
ipcRenderer.invoke('project:create', { name: string })
ipcRenderer.invoke('project:load', { id: string })
ipcRenderer.invoke('project:add-asset', { projectId: string, filePath: string })
ipcRenderer.invoke('chapter:create', { projectId: string, title: string, start: number, end: number })

// Agent interaction
ipcRenderer.invoke('agent:chat', { projectId: string, message: string })
ipcRenderer.on('agent:stream', callback)

// Exports
ipcRenderer.invoke('export:generate', { projectId: string, format: 'xml' | 'edl' | 'aaf' })
```

**Main → Renderer:**
```typescript
// Project updates
mainWindow.webContents.send('project:loaded', { projectId: string, data: any })
mainWindow.webContents.send('chapter:created', { chapterId: string })

// Agent streaming
mainWindow.webContents.send('agent:stream', { type: 'progress' | 'message' | 'result', data: any })

// Export completion
mainWindow.webContents.send('export:generated', { projectId: string, filePath: string })
```

### Main ↔ Agent Child Process

**Main → Agent (JSON over stdin/stdout):**
```typescript
{
  "type": "chat",
  "projectId": string,
  "message": string,
  "context": any  // Current project state
}

{
  "type": "spawn-chapter-agents",
  "projectId": string,
  "chapters": Array<{id: string, transcript: string, instructions: string}>
}
```

**Agent → Main (JSON over stdout):**
```typescript
// Streaming updates
{
  "type": "progress",
  "chapterId": string,
  "status": "transcribing" | "analyzing" | "extracting",
  "progress": number  // 0-100
}

{
  "type": "message",
  "content": string,  // LLM response chunk
  "source": "main" | "chapter"  // Which agent sent this
}

{
  "type": "result",
  "chapterId": string,
  "data": {  // Structured analysis results
    "beats": Array<Beat>,
    "summary": string,
    "optional": Array<{start: number, end: number, reason: string}>
  }
}

{
  "type": "error",
  "message": string
}
```

## LangGraph Graph Structure

### Main Orchestrator Graph

```typescript
// State schema
const MainState = new StateSchema({
  messages: MessagesValue,
  projectId: z.string(),
  chapters: z.array(z.object({
    id: z.string(),
    transcript: z.string().optional(),
  })),
  chapterSummaries: z.record(z.string()),
  chapterBeats: z.record(z.array(z.object({
    timestamp: z.number(),
    type: z.enum(["setup", "escalation", "twist", "payoff", "transition"]),
    description: z.string(),
    essential: z.boolean(),
  }))),
  storyAnalysis: z.optional(z.object({
    themes: z.array(z.string()),
    callbacks: z.array(z.any()),
    recommendations: z.string(),
  })),
});

// Graph flow
1. START
2. transcribe_node (if needed)
3. chat_node (conversational interface)
4. dispatch_chapters (spawn subgraphs via new Send())
5. chapter_agent (subgraph) - processes each chapter
6. story_cohesion_node (meta-pass)
7. generate_exports_node
8. END
```

### Chapter Subgraph

```typescript
const ChapterState = new StateSchema({
  chapterId: z.string(),
  transcript: z.string(),
  instructions: z.string(),  // From main agent
  summary: z.string().optional(),
  beats: z.array(z.any()).optional(),
});

// Node flow
1. narrative_analyze (Gemini video + transcript)
2. beat_extract (OpenAI/Anthropic for cost, Gemini for visual)
3. visual_verify (Gemini video API)
```

## Streaming Implementation

All agent operations use combined stream modes:

```typescript
for await (const [mode, chunk] of await graph.stream(input, {
  streamMode: ["custom", "messages"],
})) {
  if (mode === "custom") {
    // Progress updates, status changes
    sendToMain({ type: "progress", data: chunk });
  } else if (mode === "messages") {
    // Streaming LLM tokens
    sendToMain({ type: "message", content: chunk });
  }
}
```

Custom progress events from nodes:

```typescript
const analyzeChapter = async (state, config) => {
  config.writer?.({
    type: "progress",
    chapterId: state.chapterId,
    status: "analyzing",
    progress: 50,
  });
  // ... analysis logic
};
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Development (both main and renderer)
pnpm dev

# Development - renderer only
pnpm dev:renderer

# Development - main only (after building renderer)
pnpm dev:main

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Build
pnpm build

# Package (electron-builder)
pnpm dist
```

## Configuration Files

### package.json
- Main entry: `dist/electron/main.js`
- Dependencies: Electron, Svelte 5, LangChain, SQLite, FFmpeg
- Dev deps: TypeScript, Vite, Svelte 5 plugin, electron-builder
- Scripts: dev, build, lint, typecheck
- Package manager: pnpm

### tsconfig.json (renderer - Svelte)
- `compilerOptions.runes: true` (Svelte 5)
- `compilerOptions.jsx: "react-jsx"`
- Path aliases: `@/*` → `./src/renderer/*`, `$shared/*` → `./src/shared/*`

### tsconfig.electron.json (main + agent)
- CommonJS target (Node.js)
- Shared types in `src/shared`
- Main and agent can be built together

### tsconfig.renderer.json (Svelte 5)
- ESNext target
- Bundler module resolution
- Svelte 5 with runes

### vite.config.ts
- `@sveltejs/vite-plugin-svelte` with `runes: true`
- Root: `src/renderer`
- Output: `dist/renderer`
- Base: `./`
- Alias: `@`, `$shared`

### svelte.config.js
- `vitePreprocess()`
- `compilerOptions.runes: true`

### electron-builder.json
- Packager config for distributing the app
- Includes FFmpeg and Whisper binaries (or instructions for user install)

## Initial Implementation Phases

### Phase 1: Infrastructure Setup
- [ ] Initialize repository with pnpm
- [ ] Set up TypeScript configs (main, renderer, agent)
- [ ] Configure Vite + Svelte 5
- [ ] Set up Electron main process structure
- [ ] Create database schema and connection
- [ ] Set up basic Svelte 5 UI (app shell, chat interface placeholder)

### Phase 2: Agent Foundation
- [ ] Set up LangChain + LangGraph dependencies
- [ ] Implement base LLM provider interface
- [ ] Implement Gemini provider with video support
- [ ] Implement OpenAI provider
- [ ] Create state schemas (MainState, ChapterState)
- [ ] Build main orchestrator graph structure
- [ ] Build chapter subgraph structure
- [ ] Integrate child_process spawning of agent worker
- [ ] Set up IPC bridge (main ↔ agent)

### Phase 3: Core Video Processing
- [ ] FFmpeg wrapper for video operations
- [ ] Whisper integration for transcription
- [ ] Asset import project management
- [ ] Chapter creation and management
- [ ] Transcript storage and retrieval

### Phase 4: AI Analysis Features
- [ ] Implement narrative analysis prompts
- [ ] Implement beat extraction prompts
- [ ] Implement visual verification (Gemini video)
- [ ] Build chat interface with streaming
- [ ] Connect Svelte UI to agent via IPC
- [ ] Progress streaming to renderer

### Phase 5: Story Cohesion
- [ ] Implement story cohesion meta-pass
- [ ] Theme and callback detection
- [ ] Chapter ordering recommendations
- [ ] Recap suggestions

### Phase 6: NLE Exports
- [ ] XML (FCPXML) generator
- [ ] EDL generator
- [ ] AAF generator (or fallback to EDL)
- [ ] Export timeline reconstruction from beats

### Phase 7: UI Refinement
- [ ] Timeline visualization component
- [ ] Chapter list component
- [ ] Clip management UI
- [ ] Project browser
- [ ] Settings panel (API keys, preferences)

### Phase 8: Optimization & Testing
- [ ] Local/cloud toggle for Whisper
- [ ] Provider routing optimization (cost vs quality)
- [ ] Error handling and recovery
- [ ] Performance tuning
- [ ] User testing and refinement

## Notes

- Personal software project - no shipping deadlines
- Prioritize Google Gemini for video understanding
- Whisper local transcription preferred for privacy/cost
- Use LangSqlieSaver for agent state persistence (local-only, no cloud)
- All processing runs locally to respect user hardware and API key budget
- Streaming is mandatory for all agent operations (good UX)
- Non-destructive editing - original VOD never modified
- BYOK (Bring Your Own Key) for all cloud services

## References

- @AGENTS.md - High-level project reference
- @docs/phase-1-3-plan.md - Detailed task breakdown for phases 1-3 (infrastructure, agent foundation, video processing)
- @docs/phase-3b-plan.md - Detailed task breakdown for Phase 3b (timeline editor, waveforms, advanced features)
- @docs/research/langgraph-architecture.md - LangGraph implementation details
- @docs/research/svelte-5-architecture.md - Svelte 5 UI implementation details
- @docs/research/whisper-integration.md - Whisper transcription integration
- @docs/research/ffmpeg-electron-install.md - FFmpeg binary installation
- @docs/research/langgraph-child-process-streaming.md - Agent worker streaming via child process
- @docs/research/nle-export-formats.md - NLE export formats (JSON, XML, EDL)
- @docs/research/davinci-timeline-features.md - DaVinci Resolve timeline features
- @docs/research/timeline-libraries-svelte.md - Timeline libraries for Svelte/Electron
- @docs/research/ffmpeg-waveform-generation.md - FFmpeg waveform extraction
- @docs/research/waveform-rendering-options.md - Waveform rendering technologies
- @docs/research/nle-waveform-resolution.md - NLE waveform resolution standards
- @docs/research/svelte-undo-redo-patterns.md - Svelte 5 undo/redo patterns
- @docs/research/multi-track-audio-handling.md - Multi-track audio handling
