# Phase 2: Agent Foundation - Implementation Plan

### Overview
LangChain/LangGraph multi-agent system as child process, IPC streaming via NDJSON over stdin/stdout, parallel chapter sub-agents, auto-restart on crash.

**Key Decisions**: Dev mode uses .env, prod uses IPC handshake; streaming modes `["custom","messages"]`; token batching (5 OR 50ms); SQLite checkpointer same DB; NDJSON protocol; auto-restart 3x with exponential backoff.

---

### Tasks

#### Task 2.1: Install Dependencies
- Run: `pnpm add @langchain/langgraph @langchain/core @langchain/openai @langchain/google-genai @langchain/anthropic @langchain/langgraph-checkpoint-sqlite zod dotenv uuid`
- Run: `pnpm add -D vitest @vitest/ui`

#### Task 2.2: LLM Provider Factory
- `src/agent/providers/index.ts`: `createLLM(config)` factory
- Switch on provider type, return LangChain's built-in classes: `ChatGoogleGenerativeAI`, `ChatOpenAI`, `ChatAnthropic`
- Model defaults: gemini-2.0-flash-exp, gpt-4o, claude-sonnet-4-20250514

#### Task 2.3: Agent Configuration Loader
- `.env.example`: API keys template (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, DEFAULT_PROVIDER)
- `src/agent/config.ts`: `loadConfig()` function - try IPC config first, fallback to .env, validate at least one API key present

#### Task 2.4: State Schemas
- `src/agent/state/schemas.ts`: Define `MainState` with messages, projectId, chapters, chapterSummaries, chapterBeats, exports; define `ChapterState` with chapterId, transcript, instructions, summary, beats - both use Zod and LangGraph's StateSchema

#### Task 2.5: Prompt Templates
- `src/agent/prompts/narrative-analysis.ts`: Analyze transcript for narrative beats, output JSON with chapter_title, logline, beats, optional_cuts, cold_open_candidate
- `src/agent/prompts/beat-extraction.ts`: Extract essential vs optional beats (setup/escalation/twist/payoff/transition), include timestamps, essential flag
- `src/agent/prompts/story-cohesion.ts`: Meta-analysis across chapters, find callbacks/through-lines, recommend chapter order
- `src/agent/prompts/export-generation.ts`: Generate JSON cut list with projectId, cuts array (chapterId, inTime, outTime, label, notes, beats, optionalSegments)

#### Task 2.6: Main Orchestrator Graph
- `src/agent/graphs/main-orchestrator.ts`: `createMainGraph({ checkpointer })` returns compiled graph
- Nodes: `chat_node` (LLM calls, loops for conversation), `dispatch_chapters` (returns array of Send() for parallel chapter dispatch), `chapter_agent` (subgraph), `story_cohesion` (meta-pass), `generate_exports` (JSON cut list)
- Edges: START → chat_node → (loop or dispatch) → chapter_agent → story_cohesion → generate_exports → END
- Use `addConditionalEdges()` for parallel dispatch via `new Send()`

#### Task 2.7: Chapter Subgraph
- `src/agent/graphs/chapter-subgraph.ts`: `createChapterSubgraph()` returns compiled graph
- Nodes: `narrative_analyze` (LLM call, progress: analyzing_narrative), `beat_extract` (LLM call, progress: extracting_beats), `visual_verify` (stub for Phase 3, progress: verifying_visuals)
- Linear flow: START → analyze → extract → verify → END

#### Task 2.8: Child Process Entry Point
- `src/agent/index.ts`: Load config, setup SQLite checkpointer, create main graph
- Setup IPC: `JSONStdoutReader(process.stdin)` for incoming, `JSONStdinWriter(process.stdout)` for outgoing
- Send `{ type: "ready", requestId: "init" }` signal
- Message loop: Handle "chat" (messages array), "analyze-chapters" (stub), "stop" (cancel request)
- Stream graph with streamMode `["custom", "messages"]`, emit progress events and token chunks
- `streamTokens()`: Batch 5 tokens OR 50ms, send via `type: "token"` messages
- Error handling: Send `{ type: "error", ... }` on failure, log to stderr
- Shutdown: SIGTERM (cancel requests, 500ms wait), SIGINT (immediate exit), uncaughtException (exit 1)

#### Task 2.9: JSON Message Transport Utilities
- `src/agent/ipc/json-message-transport.ts`: Two classes
  - `JSONStdinWriter`: `write()` serializes JSON + newline, `writeSync()` for critical messages, `end()` closes stream
  - `JSONStdoutReader` (extends EventEmitter): Buffer accumulation, emit "message" on complete JSON lines, emit "error" on parse failures, emit "close" on stream end
- NDJSON protocol (newline delimiters)

#### Task 2.10: IPC Type Definitions
- `src/shared/types/agent-ipc.ts`: Define shared types
- Input (Parent → Child): `ChatInputMessage`, `AnalyzeChaptersInputMessage`, `StopInputMessage` - union as `AgentInputMessage`
- Output (Child → Parent): `ReadyOutputMessage`, `ProgressOutputMessage`, `TokenOutputMessage`, `GraphCompleteOutputMessage`, `ErrorOutputMessage` - union as `AgentOutputMessage`
- All have requestId, threadId optional

#### Task 2.11: Agent Bridge (Main Process)
- `src/electron/agent-bridge.ts`: `AgentBridge` class (extends EventEmitter)
- Initialization: Spawn `node agent/index.js` with piped stdio
- Setup IPC: `this.stdinWriter`, `this.stdoutReader`, message handler
- Wait for `{ type: "ready" }` signal with 10s timeout
- Auto-restart: On exit (code ≠ 0), exponential backoff 1s → 2s → 4s, max 3 attempts
- `send(message, timeoutMs)`: Returns Promise<AgentOutputMessage>, tracks pending requests with uuid, handles timeout
- Handle messages: Stream events (progress, token) → emit "stream"; final responses → resolve promise
- `stop()`: Send stop signal, wait 5s, force kill
- Singleton: `getAgentBridge()`, `resetAgentBridge()`

#### Task 2.12: IPC Handlers Update
- `src/electron/ipc/handlers.ts`: Add `AGENT_CHAT` handler using agentBridge.send(), return wrapper response

#### Task 2.13: Preload API Update
- Update `src/electron/preload.ts`: Add `agent: { chat(messages, threadId?) }` to electronAPI
- Update `src/electron/preload.d.ts`: Add agent types

#### Task 2.14: Agent State
- `src/renderer/lib/state/agent.svelte.ts`: `useAgent()` function using Svelte 5 runes
- State: `connected` ($state), `activeRequestId` ($state), `messages` ($state array)
- `chat(message, threadId)`: Add user message, set active requestId, call window.electronAPI.agent.chat(), add assistant response
- Note: UI integration in Phase 3b, state prepared now

#### Task 2.15: Main Process Agent Integration
- `src/electron/main.ts`: Import `getAgentBridge`
- After DB init, call `startAgentBridge()`: start agent, listen to stream/error/exit events, forward stream to renderer via `mainWindow.webContents.send('agent:stream')`
- On `app.on('before-quit')`: Stop agent bridge gracefully

#### Task 2.16: Update .gitignore
- Add `coverage/`, `.env`, `.env.local`

---

### Testing Strategy

**Unit Tests**:
- `tests/unit/json-message-transport.test.ts`: Test write, writeSync, partial reads, parse errors, buffer accumulation
- `tests/unit/agent-config.test.ts`: Test .env loading, API key validation, default provider

**Integration Tests**:
- `tests/integration/agent-spawn.test.ts`: Test spawn, ready signal, timeout
- `tests/integration/agent-chat.test.ts`: Test chat message, streaming tokens, graph-complete, thread persistence (all .skip for now - require API keys and build)

**Scripts** (add to package.json):
- `test`: `vitest` (watch mode)
- `test:ui`: `vitest --ui`
- `test:coverage`: `vitest --coverage`

---

### File Structure

```text
src/agent/
  ├── providers/index.ts              # LLM factory
  ├── state/schemas.ts                # MainState, ChapterState
  ├── prompts/                        # 4 prompt templates
  ├── graphs/                         # main-orchestrator, chapter-subgraph
  ├── ipc/json-message-transport.ts   # NDJSON reader/writer
  ├── config.ts                       # Config loader (IPC/.env)
  └── index.ts                        # Child process entry

src/shared/types/
  └── agent-ipc.ts                    # Shared IPC types

src/electron/
  ├── agent-bridge.ts                 # NEW: Agent worker manager
  ├── ipc/handlers.ts                 # Update: Add AGENT_CHAT
  ├── preload.ts                      # Update: Add agent API
  └── main.ts                         # Update: Spawn agent

src/renderer/lib/state/
  └── agent.svelte.ts                 # NEW: Agent state (Svelte 5)

.env.example
tests/unit/
  ├── json-message-transport.test.ts
  └── agent-config.test.ts
tests/integration/
  ├── agent-spawn.test.ts
  └── agent-chat.test.ts
```

---

### Success Criteria

1. Agent worker starts, reads .env, creates graphs, sends ready signal
2. Basic chat works via IPC with streaming tokens
3. Crashes trigger exponential backoff restart (max 3)
4. SQLite checkpointer maintains thread state across restarts
5. Both progress and token streaming modes work with batching
6. Shared types compile correctly for main and agent
7. Unit + integration tests cover core functionality
8. Agent bridge spawns, monitors, communicates with agent
9. SIGTERM/SIGINT handled correctly, no zombies
10. Code sufficiently commented
