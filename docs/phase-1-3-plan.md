# Phase 1-3 Implementation Plan - Corrected

## Phase 1: Infrastructure Setup

### Task 1.1: Initialize Repository
- [ ] Initialize pnpm project (`pnpm init`)
- [ ] Create initial folder structure (src/electron, src/agent, src/renderer, src/shared, database)
- [ ] Set up .gitignore (node_modules, dist, .env, build artifacts)

---

### Task 1.2: Configure TypeScript

**tsconfig.json (base)** - Shared settings
- Path aliases: `@` → `src/renderer`, `$shared` → `src/shared`

**tsconfig.electron.json** - Main and agent processes
- Target: ES2020, Module: CommonJS
- Include: src/electron, src/agent, src/pipeline, src/shared

**tsconfig.renderer.json** - Svelte 5 renderer
- Target: ESNext, Module: ESNext
- Compiler options (Svelte 5: runes enabled, no jsx)
- Include: src/renderer, src/shared

**tsconfig.node.json** - Config files
- Include: vite.config.ts, svelte.config.js, electron-builder config

---

### Task 1.3: Configure Vite + Svelte 5

**vite.config.ts**
- Plugin: `@sveltejs/vite-plugin-svelte` with `runes: true`
- Root: `src/renderer`, Output: `dist/renderer`, Base: `./`
- Alias: `@/` → `src/renderer`, `$shared/` → `src/shared`
- Server: port 5173

**svelte.config.js**
- Preprocessor: `vitePreprocess()`
- Compiler options: `runes: true`

---

### Task 1.4: Configure Electron & FFmpeg Install Script

**electron-builder.json** - Packaging config
- App ID, icon, platform-specific settings
- After install script for FFmpeg binary download/setup

**install-ffmpeg.js** - FFmpeg installer script
- Platform detection (Windows, macOS, Linux)
- Download FFmpeg binary from official source
- Extract to app data directory
- Add to PATH or store location for use

**src/electron/main.ts** - Entry point
- Window creation, dev server / built files loading
- FFmpeg path detection (check if installed after setup)
- IPC handler registration
- Agent worker process spawning with auto-restart logic

**src/electron/preload.ts** - Preload script
- `contextBridge.exposeInMainWorld()` for API
- Define API types

---

### Task 1.5: Database Setup

**database/schema.sql**
- CREATE TABLE: projects, assets, chapters, chapter_assets, transcripts, beats, conversations
- Indexes on: project_id, chapter_id

**src/electron/database/db.ts**
- SQLite connection (better-sqlite3)
- Database initialization (create tables if not exist)
- CRUD functions (createProject, getProject, etc.)

---

### Task 1.6: Svelte 5 UI - App Shell

**src/renderer/index.html** - HTML entry
- `<div id="app"></div>` mount point

**src/renderer/main.ts** - Entry point
- `mount(App, { target: document.getElementById('app') })`

**src/renderer/App.svelte** - Root component
- Projects view (grid of project thumbnails)
- Project detail view (sidebar + main content workspace)
- Import: ProjectList.svelte (create when ready)

**src/renderer/lib/state/project.svelte.ts** - Project state (runes)
- `projects = $state({ items: [], selectedId: null })`
- `selectedProject = $derived(...)`
- `loadProjects()`, `createProject()`, `selectProject()`

---

### Task 1.7: Basic IPC Setup

**src/electron/ipc/channels.ts** - Channel definitions
```typescript
export const IPC_CHANNELS = {
  PROJECT_CREATE: 'project:create',
  PROJECT_LOAD: 'project:load',
  PROJECT_GET_ALL: 'project:get-all',
  ASSET_ADD: 'asset:add',
  CHAPTER_CREATE: 'chapter:create',
  AGENT_CHAT: 'agent:chat',
  AGENT_STREAM: 'agent:stream',
} as const;
```

**src/electron/ipc/handlers.ts** - IPC handlers
- `PROJECT_CREATE`, `PROJECT_LOAD`, `PROJECT_GET_ALL`
- `ASSET_ADD`, `CHAPTER_CREATE`
- `AGENT_STREAM` for streaming updates

**src/electron/preload.ts** - Expose API
- `window.electronAPI.projects.create()`, etc.

**src/renderer/lib/state/electron.svelte.ts** - Electron API wrapper
- Typed functions calling `window.electronAPI.*`
- Error handling

---

## Phase 2: Agent Foundation

### Task 2.1: Install LangChain + LangGraph
```bash
pnpm add @langchain/langgraph @langchain/core @langchain/openai @langchain/google-genai @langchain/anthropic
pnpm add zod
```

---

### Task 2.2: LLM Provider Abstraction

**src/agent/providers/base.ts** - Base interface
```typescript
export interface LLMProvider {
  chat(messages: Message[]): Promise<Message>;
  stream(messages: Message[]): AsyncGenerator<string>;
}
```

**src/agent/providers/gemini.ts** - Gemini implementation
- `@langchain/google-genai`
- Video input via `GoogleAIFileManager`
- Streaming support

**src/agent/providers/openai.ts** - OpenAI implementation
- `@langchain/openai`
- Streaming, text-only tasks

**src/agent/providers/index.ts** - Provider factory
- `createLLM({ provider, apiKey, model })`

---

### Task 2.3: State Schemas (Zod)

**src/agent/state/schemas.ts**
```typescript
const MainState = new StateSchema({
  messages: MessagesValue,
  projectId: z.string(),
  chapters: z.array(z.object({
    id: z.string(),
    transcript: z.string().optional(),
  })),
  chapterSummaries: z.record(z.string()),
  chapterBeats: z.record(z.array(z.any())),
});

const ChapterState = new StateSchema({
  chapterId: z.string(),
  transcript: z.string(),
  instructions: z.string(),
  summary: z.string().optional(),
  beats: z.array(z.any()).optional(),
});
```

---

### Task 2.4: Build Main Orchestrator Graph

**src/agent/graphs/main-orchestrator.ts**
- Nodes:
  - `chat_node` - **Loops on itself** for conversational interface
  - `dispatch_chapters` - Spawn chapter subgraphs in parallel
  - `story_cohesion` - Meta analysis across chapters
  - `generate_exports` - Output JSON cut list
- Edges: START → chat_node → dispatch_chapters → chapter_agent → story_cohesion → generate_exports → END
  - **chat_node loops back to itself** for continued conversation
- Use `new Send()` API for parallel chapter subgraph spawning

---

### Task 2.5: Build Chapter Subgraph

**src/agent/graphs/chapter-subgraph.ts**
- Nodes: `narrative_analyze`, `beat_extract`, `visual_verify`
- Edges: START → narrative_analyze → beat_extract → visual_verify → END
- Separate ChapterState schema

---

### Task 2.6: Prompt Templates

**src/agent/prompts/narrative-analysis.ts**
- System prompt: straightforward task description (no "expert" language)
- Task: Analyze chapter transcript + video, identify narrative beats
- Output: JSON with chapter_title, logline, beats, optional_cuts, cold_open_candidate

**src/agent/prompts/beat-extraction.ts**
- Identify essential vs optional moments
- Setup → escalation → twist → payoff structure
- Visual dependency tagging
- Output timestamps for in/out points

**src/agent/prompts/story-cohesion.ts**
- Analyze all chapter summaries
- Find callbacks, through-lines
- Recommend chapter order

**src/agent/prompts/export-generation.ts**
- Generate JSON export format
- Structure: Array of cut points { projectId, chapterId, inTime, outTime, label, notes }

---

### Task 2.7: Child Process Spawning with Auto-Restart

**src/electron/agent-bridge.ts**
- Spawn agent: `child_process.spawn('node', ['path/to/agent/index.js'])`
- stdout/stdin JSON communication
- **Auto-restart on crash** with exponential backoff
- Message queue for requests/responses
- Process health monitoring (heartbeat)
- Graceful shutdown on app exit

**src/agent/index.ts** (child process entry)
- Read JSON from stdin
- Route to graph invocation
- Stream responses to stdout
- Handle process signals
- Error reporting

---

### Task 2.8: IPC Bridge (Main ↔ Agent)

**src/electron/ipc/agent-bridge.ts**
- Transform `agent:chat` IPC requests to child process messages
- Forward child process stream events to renderer via `mainWindow.webContents.send()`
- Map: `{ type, projectId, message }` → child process stdin
- Handle connection state, restart events

---

## Phase 3: Core Video Processing

### Task 3.1: FFmpeg Wrapper (No Cutting Operations)

**src/pipeline/ffmpeg.ts**
- `extractAudio(videoPath, outputPath)` - Extract audio for transcription
- `getVideoMetadata(path)` - Duration, codec, resolution, framerate (FFprobe)
- `generateProxy(inputPath, outputPath)` - Create fixed low-res proxy (e.g., 480p @ 15fps)
- `extractKeyframes(videoPath, timestamps, outputDir)` - Extract frames for AI visual verification
- Helper functions for command construction and error handling

**Note**: Removing `cutVideo()` function - exports will be JSON cut lists only, not actual video files.

---

### Task 3.2: Whisper Integration (faster-whisper)

**src/pipeline/transcription.ts**
- `transcribeVideo(videoPath, options)` - Run faster-whisper via Python subprocess
- Options: local (faster-whisper) vs cloud (OpenAI API)
- Output: Segments with text, start_time, end_time
- Error handling and retry logic
- **Progress tracking** (per-segment updates via IPC)

**Python wrapper script** (if needed):
- Wrapper script for faster-whisper with JSON input/output
- Output segments in structured format

---

### Task 3.3: Asset Import

**src/electron/ipc/handlers.ts**
- `ASSET_ADD`: Add file path to DB, validate with FFprobe, extract metadata
- Store in `assets` table

**UI**: File dialog, drag-and-drop support
- Throbber indicator next to each asset for transcription status

---

### Task 3.4: Chapter Management

**src/electron/ipc/handlers.ts**
- `CHAPTER_CREATE`: Create chapter in DB, link to assets
- `CHAPTER_UPDATE`: Update title, time range
- `CHAPTER_DELETE`: Remove chapter

**UI**: **Draggable markers on visual timeline** for chapter time selection
- Video player preview with chapter markers
- Drag start/end markers to adjust time range

---

### Task 3.5: Transcript Storage

**src/electron/database/db.ts**
- `saveTranscript(chapterId, segments[])` - Bulk insert
- `getTranscript(chapterId)` - Retrieve for agent
- `deleteTranscript(chapterId)` - Cleanup

**src/electron/ipc/handlers.ts**
- `TRANSCRIPT_GET`: Fetch transcript for UI display
- Background job queue for transcription with progress updates
- **Throbber UI**: Status icon per asset (pending, running, succeeded, failed)

---

### Task 3.6: Transcription Background Job

**src/electron/jobs/transcription-job.ts**
- Queue system for transcription jobs
- Status: pending, running, completed, failed
- **Per-segment progress updates** via IPC (for throbber UI)
- Error handling and retry

**UI components**:
- `AssetList.svelte` - Display assets with status throbbers
- `Throbber.svelte` - Animated indicator (pending, spinning, checkmark, X)

---

### Task 3.7: Export Generation (JSON Cut List)

**src/pipeline/export.ts**
- `generateCutList(projectId, cuts)` - Output JSON file
- Structure:
```json
{
  "projectId": "uuid",
  "projectName": "string",
  "format": "vod-pipeline-cutlist-v1",
  "created": "ISO-8601 timestamp",
  "cuts": [
    {
      "chapterId": "uuid",
      "chapterTitle": "string",
      "assetPath": "absolute/path/to/original/video",
      "inTime": 123.456,
      "outTime": 456.789,
      "duration": 333.333,
      "label": "setup",
      "notes": "why_essential text",
      "beats": [
        {"type": "setup", "timestamp": 123.456, "description": "..."},
        {"type": "escalation", "timestamp": 200.0, "description": "..."}
      ],
      "optionalSegments": [
        {"start": 150.0, "end": 180.0, "reason": "repeated explanation"}
      ]
    }
  ],
  "exportFormat": "resolve-xml" | "premiere-edl" | "json-only"
}
```

**Future extension**: JSON cut list can be transformed to XML/EDL for direct import into DaVinci/Premiere. For now, focus on JSON format that tools can generate Resolve-compatible XML from.

---

## UX Decisions (Confirmed)

1. **Chapters**: Draggable markers on visual timeline
2. **Transcription**: Throbber per asset (pending/spinning/done/error)
3. **Projects**: Abstracted file org - projects view with thumbnails, click to access
4. **Video proxies**: Fixed low-res (480p @ 15fps)
5. **FFmpeg**: Install script in package, downloads/extracts on install

---

## Summary

**Phase 1**: 15 tasks - Repo, TypeScript, Vite/Svelte 5, Electron, DB IPC, UI shell

**Phase 2**: 8 tasks - LangChain, providers, state, graphs, prompts, child_process, auto-restart

**Phase 3**: 7 tasks - FFmpeg (proxies only, no cutting), faster-whisper, assets, chapters, transcription jobs, JSON exports

**Phase 3b**: Timeline Editor & Advanced Features (8-10 weeks) - See @docs/phase-3b-plan.md
- Fully featured canvas-based timeline (no layers, multi-track audio)
- 5-tier waveform LOD system (20-200 Hz default tiers)
- Undo/redo for all timeline operations
- Beat list panel synced with timeline
- Clip preview with in/out editing
- JSON/XML/EDL export with track selection

**Changes from original**:
- Chat node loops on itself
- Export = JSON cut list (not XML/EDL directly)
- No "expert YouTube editor" prompt language
- FFmpeg = install script (no cutting operations)
- faster-whisper (Python subprocess)
- Agent worker = auto-restart
- Fixed low-res proxies
- Draggable chapter markers
- Throbber per asset for transcription
- Abstracted project file org with thumbnail view

