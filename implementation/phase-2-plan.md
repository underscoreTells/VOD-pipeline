# Phase 2: Agent Foundation - Implementation Plan

## Overview

Phase 2 sets up the **LangChain + LangGraph multi-agent system** that runs as a child process (isolated from main Electron process), supports parallel chapter sub-agents via LangGraph's `Send()` API, streams LLM tokens + progress updates via IPC (NDJSON over stdin/stdout), and auto-restarts on crash with exponential backoff.

### Architecture Summary

**Key flow**:
- **Dev**: Agent reads `.env` on startup for API keys
- **Prod**: Main process loads keys from secure storage, sends via IPC to agent
- **Phase 2 scope**: Dev mode implemented. Prod IPC handshake architected but stubbed

**Key passing mechanism (Phase 2)**:
1. Agent starts, attempts to read from IPC (doesn't exist in dev)
2. Falls back to `.env` file
3. Sends `{ type: "ready" }` to signal ready
4. Main process can now send requests

**Streaming approach**:
- Batch tokens (threshold: 5 tokens OR 50ms)
- Progress updates per stage within node (e.g., "initializing" → "processing" → "complete", with 0-100%)
- Stream modes: `["custom", "messages"]` for progress + LLM tokens

**Persistence**: Use same DB as project (`vod-pipeline.db`) for SQLite checkpointer

---

## Task Breakdown

### Task 2.1: Install Dependencies

Install LangChain, LangGraph, provider SDKs, SQLite checkpointer, Zod, dotenv, UUID.

**Command**:
```bash
pnpm add @langchain/langgraph @langchain/core @langchain/openai @langchain/google-genai @langchain/anthropic @langchain/langgraph-checkpoint-sqlite zod dotenv uuid
pnpm add -D vitest @vitest/ui
```

**Package** | **Purpose**
---|---
`@langchain/langgraph` | LangGraph orchestration framework
`@langchain/core` | Core LangChain types/interfaces
`@langchain/openai` | OpenAI provider SDK
`@langchain/google-genai` | Google Gemini provider SDK
`@langchain/anthropic` | Anthropic provider SDK
`@langchain/langgraph-checkpoint-sqlite` | SQLite persistence for threads
`zod` | Schema validation for state
`dotenv` | .env file parsing (dev mode)
`uuid` | Request ID generation
`vitest` | Testing framework (integration with Vite)
`@vitest/ui` | Visual test interface

---

### Task 2.2: LLM Provider Factory (Using LangChain's Built-ins)

**File**: `src/agent/providers/index.ts`

**Purpose**: Factory function that returns LangChain's built-in model classes

**Implementation**:
- Define `LLMConfig` interface
- `createLLM(config: LLMConfig): BaseChatModel`
  - Switch on provider type
  - Return appropriate LangChain model class:
    - Gemini → `ChatGoogleGenerativeAI` from `@langchain/google-genai`
    - OpenAI → `ChatOpenAI` from `@langchain/openai`
    - Anthropic → `ChatAnthropic` from `@langchain/anthropic`
  - Model defaults:
    - `'gemini-2.0-flash-exp'` (fast, good for development)
    - `'gpt-4o'` (general purpose)
    - `'claude-sonnet-4-20250514'` (balanced)

**Note**: No custom base interfaces - use LangChain's existing provider SDKs directly

---

### Task 2.3: Agent Configuration Loader

**File**: `.env.example` (create at project root)

```
# AI Provider API Keys
GEMINI_API_KEY=your_gemini_key_here
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here

# Default Provider
DEFAULT_PROVIDER=gemini
```

**File**: `src/agent/config.ts`

**Purpose**: Load configuration from IPC (prod) or .env (dev)

**Implementation**:
- Define `AgentConfig` interface with LLM parameters
- Export `ipcConfig` object (placeholder) for main process to set via IPC before "ready"
- `async loadConfig(): Promise<AgentConfig>`
  - Try IPC-provided config first (if `ipcConfig` is set)
  - Fallback: `dotenv.config()` loads from `.env` at project root
  - Required: At least one provider API key available
  - Default provider: `process.env.DEFAULT_PROVIDER || 'gemini'`
- Validation: Ensure at least one API key is present, throw if not

**For Phase 2**: Dev mode loads from `.env`. Prod IPC config will be set in next phase

---

### Task 2.4: State Schemas (Zod)

**File**: `src/agent/state/schemas.ts`

**Purpose**: Define type-safe state schemas for MainState and ChapterState

**MainState**:
```typescript
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import * as z from "zod";

const MainState = new StateSchema({
  messages: MessagesValue, // Chat history (array of { role, content })
  projectId: z.string(),
  chapters: z.array(z.object({
    id: z.string(),
    transcript: z.string().optional(),
  })),
  chapterSummaries: z.record(z.string()), // chapterId → summary text
  chapterBeats: z.record(z.array(z.any())), // chapterId → beats array
  exports: z.object({
    cuts: z.array(z.any()).optional(),
  }).optional(),
});
```

**ChapterState**:
```typescript
const ChapterState = new StateSchema({
  chapterId: z.string(),
  transcript: z.string(),
  instructions: z.string(),
  summary: z.string().optional(),
  beats: z.array(z.any()).optional(),
});
```

---

### Task 2.5: Prompt Templates

**File**: `src/agent/prompts/narrative-analysis.ts`

**Purpose**: Analyze chapter transcript for narrative structure

**Implementation**:
- System prompt: "Analyze this video chapter transcript for narrative structure."
- Task: Identify story beats, key moments, fluff content
- Output format (structured JSON or plain JSON):
  ```json
  {
    "chapter_title": "...",
    "logline": "One-sentence summary",
    "beats": [
      { "type": "setup/payload/twist/payoff", "timestamp": 123.45, "description": "..." }
    ],
    "optional_cuts": [
      { "start": 150.0, "end": 180.0, "reason": "repeated explanation" }
    ],
    "cold_open_candidate": true/false
  }
  ```
- Use `ChatPromptTemplate.fromMessages()` or `SystemMessagePromptTemplate`
- No "expert" language - straightforward instructions

---

**File**: `src/agent/prompts/beat-extraction.ts`

**Purpose**: Extract essential vs optional moments

**Implementation**:
- System prompt: "Extract narrative beats from this chapter."
- Beat types: `setup`, `escalation`, `twist`, `payoff`, `transition`
- Mark each beat as `essential: true/false`
- Include timestamps for in/out points
- Visual dependency tagging (which beats need visual verification)
- Output: JSON with beats array

---

**File**: `src/agent/prompts/story-cohesion.ts`

**Purpose**: Meta-analysis across all chapters

**Implementation**:
- Input: All chapter summaries and beats
- Task: Find callbacks, through-lines, recommend chapter order
- Output: JSON structure with themes, callbacks array, recommendations text

---

**File**: `src/agent/prompts/export-generation.ts`

**Purpose**: Generate JSON cut list

**Implementation**:
- Input: All chapter beats and metadata
- Output format matching Phase 1.3.7 (`docs/phase-1-3-plan.md` line 354-381):
  ```json
  {
    "projectId": "...",
    "projectName": "...",
    "format": "vod-pipeline-cutlist-v1",
    "created": "ISO-8601",
    "cuts": [
      {
        "chapterId": "...",
        "chapterTitle": "...",
        "assetPath": "/absolute/path...",
        "inTime": 123.456,
        "outTime": 456.789,
        "duration": 333.333,
        "label": "setup",
        "notes": "why_essential",
        "beats": [...],
        "optionalSegments": [...]
      }
    ]
  }
  ```

---

### Task 2.6: Main Orchestrator Graph

**File**: `src/agent/graphs/main-orchestrator.ts`

**Purpose**: Top-level coordination graph with chat interface and parallel chapter dispatch

**Structure**:

1. **`chat_node`** (state, config)
   - Creates LLM using `createLLM(config)`
   - Calls LLM with state.messages
   - Returns `{ messages: [new_message] }`
   - Conditional edge: Loop back to `chat_node` for continued conversation

2. **`dispatch_chapters`** (state, config)
   - Conditional edge returns array of `new Send()` calls (one per chapter)
   - Each `Send` dispatches to `chapter_agent` node with chapter-specific state
   - Pattern: `return state.chapters.map(ch => new Send("chapter_agent", { chapterId: ch.id, transcript: ch.transcript }))`

3. **`chapter_agent`** (subgraph)
   - Receives chapter-specific state from `dispatch_chapters`
   - Invokes `createChapterSubgraph(config)`
   - Processes in parallel across all chapters
   - Returns results to parent state

4. **`story_cohesion_node`** (state, config)
   - Analyzes state.chapterSummaries and state.chapterBeats
   - Calls LLM with story-cohesion prompt
   - Returns `{ storyAnalysis: ... }`

5. **`generate_exports_node`** (state, config)
   - Generates JSON cut list from all chapter beats
   - Returns `{ exports: { cuts: [...] } }`

**Edges** (using LangGraph's `addConditionalEdges()` for parallel dispatch):
```typescript
const workflow = new StateGraph(MainState)
  .addNode("chat_node", chatNode)
  .addNode("dispatch_chapters", dispatchChaptersNode)
  .addNode("chapter_agent", createChapterSubgraph(config))
  .addNode("story_cohesion", storyCohesionNode)
  .addNode("generate_exports", generateExportsNode)

  .addEdge(START, "chat_node")

  .addConditionalEdges("chat_node", (state) => {
    // If conversation should continue, loop back to chat_node
    // If analyze chapters, go to dispatch_chapters
    return shouldContinueConversation(state) ? "chat_node" : "dispatch_chapters";
  })

  .addConditionalEdges("dispatch_chapters", (state) => {
    // Spawn parallel chapter subgraphs: array of Send objects
    return state.chapters.map(chapter =>
      new Send("chapter_agent", { chapterId: chapter.id, transcript: chapter.transcript })
    );
  })

  .addEdge("chapter_agent", "story_cohesion")
  .addEdge("story_cohesion", "generate_exports")
  .addEdge("generate_exports", END)

  .compile({ checkpointer });
```

**Configuration**:
- Accepts `checkpointer` (SQLite) for thread persistence
- Accepts `config` (AgentConfig with API keys)
- Emit progress events via `config.writer({ type: "progress", status: "...", progress: N })`

**Export**: `createMainGraph({ checkpointer, config }): CompiledGraph`

---

### Task 2.7: Chapter Subgraph

**File**: `src/agent/graphs/chapter-subgraph.ts`

**Purpose**: Per-chapter analysis (narrative → beats → verify)

**Structure**:

1. **`narrative_analyze_node`** (state)
   - Calls LLM with narrative-analysis prompt
   - Input: `state.transcript`
   - Output: `summary`, `beats` initial draft
   - Progress: "analyzing_narrative", 0-100%

2. **`beat_extract_node`** (state)
   - Calls LLM with beat-extraction prompt
   - Input: `state.summary`, `state.transcript`
   - Output: Refined `beats` array with timestamps
   - Progress: "extracting_beats", 0-100%

3. **`visual_verify_node`** (state)
   - Placeholder for Gemini video API (Phase 3)
   - For Phase 2: Stub with comment
   - Optionally verify beats against visual frames
   - Progress: "verifying_visuals", 0-100%

**Edges**:
```typescript
const workflow = new StateGraph(ChapterState)
  .addNode("narrative_analyze", narrativeAnalyzeNode)
  .addNode("beat_extract", beatExtractNode)
  .addNode("visual_verify", visualVerifyNode)

  .addEdge(START, "narrative_analyze")
  .addEdge("narrative_analyze", "beat_extract")
  .addEdge("beat_extract", "visual_verify")
  .addEdge("visual_verify", END)

  .compile();
```

**Export**: `createChapterSubgraph(config): CompiledGraph`

---

### Task 2.8: Child Process Entry Point

**File**: `src/agent/index.ts`

**Purpose**: Agent worker process - reads stdin, invokes graph, streams to stdout

**Initialization sequence** (on startup):
1. Load config: `const config = await loadConfig()`
2. Setup checkpointer: `const checkpointer = SqliteSaver.fromConnString(dbPath)`
3. Create graphs: `const mainGraph = createMainGraph({ checkpointer, config })`
4. Setup IPC:
   - `const stdinReader = new JSONStdoutReader(process.stdin)` (reads messages)
   - `const stdoutWriter = new JSONStdinWriter(process.stdout)` (writes responses)
5. Send ready signal: `stdoutWriter.write({ type: "ready", requestId: "init" })`

**Message handling loop**:
```typescript
stdinReader.on("message", async (message: AgentInputMessage) => {
  const { type, requestId, threadId } = message;

  // Track request with AbortController for cancellation
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    let input = {};
    switch (type) {
      case "chat":
        input = { messages: message.messages };
        break;
      case "analyze-chapters":
        // Not fully functional in Phase 2 (no project/chapter data yet)
        break;
    }

    // Stream graph execution
    await streamGraph(mainGraph, input, requestId, threadId);
  } finally {
    activeRequests.delete(requestId);
  }
});
```

**Stream graph execution**:
```typescript
async function streamGraph(graph, input, requestId, threadId?) {
  // Stream modes: custom (progress) + messages (tokens)
  const stream = await graph.stream(input, {
    configurable: threadId ? { thread_id: threadId } : undefined,
    streamMode: ["custom", "messages"],
    signal: activeRequests.get(requestId)?.signal,
  });

  for await (const [mode, chunk] of stream) {
    if (mode === "custom") {
      // Progress events: batch per node update
      stdoutWriter.write({
        type: "progress",
        requestId,
        ...chunk
      });
    } else if (mode === "messages") {
      // Token chunks: batch 5 tokens OR 50ms
      await streamTokens(chunk, requestId);
    }
  }

  // Get final state
  const finalState = await graph.getState({ configurable: { thread_id: threadId } });
  stdoutWriter.write({
    type: "graph-complete",
    requestId,
    result: finalState.values,
    threadId: threadId ?? ""
  });
}
```

**Token batching**:
```typescript
async function streamTokens(chunk, requestId) {
  let contentBuffer = "";
  const [messageChunk, metadata] = chunk;

  // Flush on 5 tokens or 50ms timeout
  for (const char of messageChunk.content) {
    contentBuffer += char;
    if (contentBuffer.length >= 5) {
      await flushTokenBuffer(contentBuffer, requestId, metadata);
      contentBuffer = "";
    }
  }
}
```

**Error handling**:
- Catch errors in message handling loop
- Send `{ type: "error", requestId, error, code, details }` via stdout
- Log to stderr (visible in main process)

**Shutdown handlers**:
- `SIGTERM`: Cancel active requests, end stdin, wait 500ms, exit 0
- `SIGINT`: Immediate exit 0
- `uncaughtException`: Log to stderr, exit 1

---

### Task 2.9: JSON Message Transport Utilities

**File**: `src/agent/ipc/json-message-transport.ts`

**Purpose**: NDJSON serialization/deserialization for stdin/stdout

**Two classes**:

1. **`JSONStdinWriter`** (outgoing to child process, via stdout)
   - `write(message): boolean` - Serializes to JSON, adds newline, writes to Writable
   - `writeSync(message)` - Synchronous version for critical messages (like "ready")
   - `end()` - Close stream

2. **`JSONStdoutReader`** (incoming from child process, via stdin)
   - Extends EventEmitter
   - Handles partial reads via buffer accumulation
   - `emit("message", parsedMessage)` on complete JSON lines
   - `emit("error", Error)` on parse failures
   - `emit("close")` on stream end

**Implementation detail**: Use newline delimiters (\n) for simplicity (NDJSON)

---

### Task 2.10: IPC Type Definitions

**File**: `src/shared/types/agent-ipc.ts`

**Purpose**: Shared types for parent↔child communication

**Parent → Child** (AgentInputMessage union type):
```typescript
export type AgentInputMessage =
  | ChatInputMessage
  | AnalyzeChaptersInputMessage
  | StopInputMessage;

export interface ChatInputMessage {
  type: "chat";
  requestId: string;
  threadId?: string;
  messages: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface AnalyzeChaptersInputMessage {
  type: "analyze-chapters";
  requestId: string;
  threadId?: string;
  projectId: string;
  chapters: Array<{
    id: string;
    transcript: string;
    videoPath?: string;
  }>;
  instructions: string;
}

export interface StopInputMessage {
  type: "stop";
  requestId: string;
}
```

**Child → Parent** (AgentOutputMessage union type):
```typescript
export type AgentOutputMessage =
  | ReadyOutputMessage
  | ProgressOutputMessage
  | TokenOutputMessage
  | NodeCompleteOutputMessage
  | GraphCompleteOutputMessage
  | ErrorOutputMessage;

export interface ReadyOutputMessage {
  type: "ready";
  requestId: string;
}

export interface ProgressOutputMessage {
  type: "progress";
  requestId: string;
  status: string;
  progress: number;
  metadata?: Record<string, unknown>;
}

export interface TokenOutputMessage {
  type: "token";
  requestId: string;
  content: string;
  role: string;
  nodeName: string;
  metadata?: Record<string, unknown>;
}

export interface NodeCompleteOutputMessage {
  type: "node-complete";
  requestId: string;
  nodeName: string;
  output: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface GraphCompleteOutputMessage {
  type: "graph-complete";
  requestId: string;
  result: Record<string, unknown>;
  threadId: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorOutputMessage {
  type: "error";
  requestId: string;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
```

**Note**: These types are shared so both main and agent processes use same message contracts

---

### Task 2.11: Agent Bridge (Main Process)

**File**: `src/electron/agent-bridge.ts`

**Purpose**: Spawn, monitor, and communicate with agent worker process

**Class: AgentBridge** (extends EventEmitter)

**Initialization**:
```typescript
const agentPath = app.isPackaged
  ? path.join(process.resourcesPath, "agent", "index.js")
  : path.join(__dirname, "../../agent/index.js");

this.process = spawn("node", [agentPath], { stdio: ["pipe", "pipe", "pipe"] });
```

**Setup IPC**:
- `this.stdinWriter = new JSONStdinWriter(this.process.stdin)`
- `this.stdoutReader = new JSONStdoutReader(this.process.stdout)`
- `stdoutReader.on("message", this.handleMessage.bind(this))`
- `process.stderr.on("data", (chunk) => console.error(\`[Agent] \${chunk}\`))`

**Wait for ready**:
- Block until收到 `{ type: "ready" }` message
- Use Promise with 10s timeout
- Timeout error means agent failed to start

**Auto-restart logic**:
- On `exit` event (code ≠ 0):
  - Increment restart counter
  - Exponential backoff: 1s → 2s → 4s
  - Max 3 restart attempts
  - After max attempts: Emit "error" event
- Graceful shutdown on app exit

**Send message**:
```typescript
async send(message: Omit<AgentInputMessage, "requestId">, timeoutMs=300000): Promise<AgentOutputMessage> {
  const requestId = uuidv4();
  const fullMessage = { ...message, requestId };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      reject(new Error(`Agent request timeout: ${requestId}`));
    }, timeoutMs);

    this.pendingRequests.set(requestId, {
      timeout,
      resolve: (value) => resolve(value),
      reject: (reason) => reject(reason),
    });

    this.stdinWriter.write(fullMessage);
  });
}
```

**Handle message**:
- Stream events (`progress`, `token`, `node-complete`) → emit via `"stream"` event
- Final responses (`graph-complete`, `error`) → resolve pending promise

**Stop**:
- Send `{ type: "stop", requestId: "shutdown" }`
- Wait 5s for graceful exit
- Force kill after timeout

**Singleton export**:
```typescript
let agentBridge: AgentBridge | null = null;

export function getAgentBridge(): AgentBridge {
  if (!agentBridge) {
    agentBridge = new AgentBridge();
  }
  return agentBridge;
}

export function resetAgentBridge(): void {
  agentBridge = null;
}
```

---

### Task 2.12: IPC Handlers Update

**File**: `src/electron/ipc/handlers.ts`

**Update**:

Add handler for `AGENT_CHAT` (in IPC_CHANNELS):
```typescript
ipcMain.handle(IPC_CHANNELS.AGENT_CHAT, async (event, request) => {
  const agentBridge = getAgentBridge();

  // Send to agent process
  const response = await agentBridge.send({
    type: "chat",
    messages: request.messages,
    threadId: request.threadId,
  });

  return {
    success: true,
    data: response,
  };
});
```

**Note**: Not implementing analyze-chapters handler yet (Phase 3b - no project data structure ready)

---

### Task 2.13: Preload API Update

**File**: `src/electron/preload.ts`

**Update**: Add agent chat function to `ElectronAPI`:
```typescript
const electronAPI = {
  projects: {
    create: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CREATE, { name }),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_GET_ALL),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_GET, { id }),
  },
  agent: {
    chat: async (messages: Message[], threadId?: string) => {
      return ipcRenderer.invoke(IPC_CHANNELS.AGENT_CHAT, { messages, threadId });
    },
  },
};
```

**File**: `src/electron/preload.d.ts`
- Update type definitions accordingly

---

### Task 2.14: Agent State (Svelte 5)

**File**: `src/renderer/lib/state/agent.svelte.ts`

**Purpose**: Wrapper functions for agent API (no UI in Phase 2, but state ready for next phase)

**Implementation** using Svelte 5 runes:
```typescript
import { writable, derived } from 'svelte/store';

export function useAgent() {
  const connected = $state(false);
  const activeRequestId = $state<string | null>(null);
  const messages = $state<Array<{ role: string; content: string }>>([]);

  async function chat(message: string, threadId?: string) {
    const userMessage = { role: "user" as const, content: message };
    messages = [...messages, userMessage];

    activeRequestId = uuidv4();

    // Stream tokens via event listener (implementation stubbed for now)
    const response = await window.electronAPI.agent.chat({
      role: "user",
      content: message,
    });

    messages = [...messages, { role: "assistant", content: response.result }];
    activeRequestId = null;
  }

  return {
    connected,
    activeRequestId,
    messages,
    chat,
  };
}
```

**Note**: This file prepares state management for Phase 3b UI. For Phase 2, we can test via direct IPC calls from main process.

---

### Task 2.15: Main Process Agent Integration

**File**: `src/electron/main.ts`

**Update**: Spawn agent bridge on app startup

**Implementation**:
- After database initialization, start agent bridge
- Handle agent bridge events ("stream", "error", "exit")
- Graceful shutdown sequence on app quit

```typescript
import { getAgentBridge } from "./agent-bridge";

async function startAgentBridge() {
  try {
    const agentBridge = getAgentBridge();
    await agentBridge.start();

    agentBridge.on("stream", (message) => {
      // Forward stream events to renderer
      mainWindow?.webContents.send("agent:stream", message);
    });

    agentBridge.on("error", (error) => {
      console.error("[AgentBridge] Error:", error);
    });

    agentBridge.on("exit", (code, signal) => {
      console.log(`[AgentBridge] Exited: ${code} (${signal})`);
    });

    console.log("[Main] Agent bridge started");
  } catch (error) {
    console.error("[Main] Failed to start agent bridge:", error);
  }
}

// Call after window creation
await startAgentBridge();

// Handle app quit
app.on("before-quit", async () => {
  const agentBridge = getAgentBridge?.();
  if (agentBridge) {
    await agentBridge.stop();
  }
});
```

---

### Task 2.16: Update .gitignore

**File**: `.gitignore`

**Update**: Add test coverage and environment files

```
# Test coverage
coverage/

# Environment files
.env
.env.local
```

---

## Testing Strategy

### Unit Tests

**File**: `tests/unit/json-message-transport.test.ts`

Test JSON message transport utilities:
- JSONStdinWriter write() serializes correctly
- JSONStdinWriter writeSync() works synchronously
- JSONStdoutReader handles partial reads
- JSONStdoutReader emits errors on invalid JSON
- JSONStdoutReader handles buffer accumulation

**File**: `tests/unit/agent-config.test.ts`

Test agent config loader:
- loadConfig() reads from .env correctly
- loadConfig() validates API keys presence
- loadConfig() throws if no API keys found
- loadConfig() uses default provider if not specified

### Integration Tests

**File**: `tests/integration/agent-spawn.test.ts`

Test agent bridge spawning:
- Agent bridge spawns successfully
- Agent sends "ready" signal
- Main process waits for ready signal
- Timeout works if agent fails to start

**File**: `tests/integration/agent-chat.test.ts`

Test basic agent interaction:
- Send chat message to agent
- Receive streaming token events
- Receive graph-complete event
- Thread persistence across calls

### Test Execution

Add to `package.json`:
```json
"scripts": {
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest --coverage"
}
```

Run tests:
```bash
pnpm test              # Run tests in watch mode
pnpm test:ui          # Run with Vitest UI
pnpm test:coverage    # Generate coverage report
```

---

## File Structure

```
src/
├── agent/
│   ├── providers/
│   │   └── index.ts                      # LLM factory (no custom wrappers)
│   ├── state/
│   │   └── schemas.ts                    # MainState, ChapterState with Zod
│   ├── prompts/
│   │   ├── narrative-analysis.ts
│   │   ├── beat-extraction.ts
│   │   ├── story-cohesion.ts
│   │   └── export-generation.ts
│   ├── graphs/
│   │   ├── main-orchestrator.ts          # Top-level graph with chat + dispatch
│   │   └── chapter-subgraph.ts           # Per-chapter analysis subgraph
│   ├── ipc/
│   │   └── json-message-transport.ts     # NDJSON reader/writer utilities
│   ├── config.ts                         # Load from IPC (prod) or .env (dev)
│   └── index.ts                          # Child process entry point
├── shared/
│   └── types/
│       └── agent-ipc.ts                  # Shared type definitions
├── electron/
│   ├── agent-bridge.ts                   # NEW: Agent worker manager
│   ├── ipc/
│   │   ├── channels.ts                   # Update: Add AGENT_CHAT
│   │   └── handlers.ts                   # Update: Add AGENT_CHAT handler
│   ├── preload.ts                        # Update: Agent chat API
│   └── main.ts                           # Update: Spawn agent on startup
└── renderer/
    └── lib/
        └── state/
            └── agent.svelte.ts           # NEW: Agent state (Svelte 5)

.env.example                                # NEW: API key template
tests/
├── unit/
│   ├── json-message-transport.test.ts     # NEW
│   └── agent-config.test.ts               # NEW
└── integration/
    ├── agent-spawn.test.ts                # NEW
    └── agent-chat.test.ts                 # NEW
```

---

## Key Technical Decisions Summary

| **Aspect** | **Decision** |
|---|---|
| Provider abstraction | Use LangChain's built-in classes (ChatOpenAI, ChatGoogleGenerativeAI, ChatAnthropic) |
| API keys (dev) | Agent reads `.env` on startup |
| API keys (prod) | Main process loads from secure storage, passes via IPC handshake |
| Streaming modes | `["custom", "messages"]` (progress + tokens) |
| Token batching | 5 tokens OR 50ms threshold |
| Progress updates | Per stage within node (status + 0-100%) |
| Checkpointer | SQLite, same DB as project (`vod-pipeline.db`) |
| IPC protocol | NDJSON (newline-delimited JSON) over stdin/stdout |
| Auto-restart | Max 3 attempts, exponential backoff (1s → 2s → 4s) |
| State preservation | Threads persist via checkpointer (same threadId across restarts) |
| UI | None in Phase 2 (state prepared for Phase 3b) |
| Parallel dispatch | Use `addConditionalEdges()` returning array of `Send()` objects |
| Testing | Vitest (integrates with Vite), unit + integration tests |

---

## Manual Testing Checklist (Phase 2)

1. [ ] Install dependencies: `pnpm install`
2. [ ] Create `.env` with at least one API key (copy `.env.example`)
3. [ ] TypeScript compiles: `pnpm typecheck`
4. [ ] Tests pass: `pnpm test`
5. [ ] Start app: `pnpm dev`
6. [ ] Verify agent process spawns (check `ps aux | grep "agent/index.js"`)
7. [ ] Check logs for `[Agent] Worker process started` and ready signal
8. [ ] Test basic chat via IPC (create simple script or use test suite)
9. [ ] Verify streaming tokens (`type: "token"` messages)
10. [ ] Verify progress events (`type: "progress"` messages)
11. [ ] Test crash/restart: Kill agent manually, verify auto-restart
12. [ ] Check SQLite checkpointer creates `checkpoints` table in same DB
13. [ ] Verify thread persistence: Send multiple messages with same threadId
14. [ ] Test timeout: Send request with invalid node, verify 5-minute timeout
15. [ ] Check memory usage: Monitor agent process memory during prolonged operation

---

## Success Criteria

Phase 2 is complete when:

1. **Agent Worker**: Child process starts, reads .env, creates graphs, sends ready signal
2. **Chat Interface**: Basic chat works via IPC with streaming tokens
3. **Auto-restart**: Crashes trigger exponential backoff restart (max 3 attempts)
4. **Persistence**: SQLite checkpointer maintains thread state across restarts
5. **Streaming**: Both progress and token modes work with batching
6. **Type Safety**: Shared types compile correctly for main and agent processes
7. **Tests**: Unit and integration tests cover core functionality
8. **IPC Bridge**: Agent bridge spawns, monitors, communicates with agent
9. **Graceful Shutdown**: SIGTERM/SIGINT handle correctly, no zombie processes
10. **Documentation**: Code is sufficiently commented, plan document updated

---

## Next Phase (Phase 3 Preview)

Phase 3 will focus on **Core Video Processing**:
- FFmpeg wrapper (proxies, metadata, keyframe extraction)
- Whisper integration (faster-whisper via Python subprocess)
- Asset import with transcription background jobs
- Chapter management with timeline UI
- Beat extraction and visual verification integration
- JSON cut list export generation

---

## References

- LangGraph Architecture: `docs/research/langgraph-architecture.md`
- Child Process Streaming: `docs/research/langgraph-child-process-streaming.md`
- Phase 1-3 Plan: `docs/phase-1-3-plan.md`
- LangGraph JS Docs: https://js.langchain.com/docs/langgraph
