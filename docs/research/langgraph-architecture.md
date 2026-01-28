# LangGraph Architecture Research

## Overview

LangGraph is a low-level orchestration framework and runtime for building stateful, long-running agents. It focuses on agent **orchestration** rather than abstraction, providing:

- **Durable execution**: Agents persist through failures and can run for extended periods
- **Human-in-the-loop**: Inspect and modify agent state at any point
- **Comprehensive memory**: Short-term (messages) and long-term (store) memory
- **Streaming**: Real-time token and state updates
- **Subgraphs**: Nested graphs for multi-agent systems
- **Time travel**: Replay prior executions and fork state

## 1. LangGraph Project Structure

### Recommended Folder Structure

```
my-app/
├── src                              # All project code lies within here
│   ├── utils/                       # Optional utilities for your graph
│   │   └── tools.ts                 # Tools for your graph
│   ├── nodes/                       # Node functions for your graph
│   │   ├── chapter-agent.ts         # Chapter-specific agent nodes
│   │   ├── main-orchestrator.ts     # Main coordinator nodes
│   │   └── video-processing.ts      # Video operation nodes
│   ├── state/                       # State definitions
│   │   └── schemas.ts               # State schemas for graphs
│   ├── graphs/                      # Graph definitions
│   │   ├── main-graph.ts            # Main coordinator graph
│   │   ├── chapter-graph.ts         # Per-chapter subgraph
│   │   └── beat-extraction.ts       # Beat extraction workflow
│   ├── tools/                       # Custom tools
│   │   ├── video-tools.ts           # FFmpeg processing tools
│   │   ├── transcript-tools.ts      # Whisper integration
│   │   └── gemini-tools.ts          # Gemini video analysis tools
│   ├── prompts/                     # Prompt templates
│   │   ├── narrative-analyze.ts     # Narrative analysis prompts
│   │   ├── beat-extraction.ts       # Beat extraction prompts
│   │   └── story-cohesion.ts        # Cohesion analysis prompts
│   ├── providers/                   # LLM provider abstractions
│   │   ├── base.ts                  # Base LLM provider interface
│   │   ├── gemini.ts                # Gemini provider
│   │   └── openai.ts                # OpenAI provider
│   ├── agent.ts                     # Main graph constructor
│   └── config.ts                    # Configuration
├── package.json                     # Package dependencies
├── .env                             # Environment variables
└── langgraph.json                   # LangGraph configuration file (for deployment)
```

### Configuration File (`langgraph.json`)

For deployment with LangSmith:

```json
{
  "dependencies": ["."],
  "graphs": {
    "main_agent": "./src/graphs/main-graph.ts:agent"
  },
  "env": {
    "GEMINI_API_KEY": "{{SECRET}}"
  }
}
```

### Dependencies

```json
{
  "dependencies": {
    "@langchain/langgraph": "^0.0.0",
    "@langchain/core": "^0.0.0",
    "@langchain/anthropic": "^0.0.0",
    "@langchain/openai": "^0.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

## 2. State Management

### State Schemas

Use `StateSchema` with Zod for type-safe state definitions:

```typescript
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import * as z from "zod";

// Main supervisor state
const MainState = new StateSchema({
  messages: MessagesValue,
  projectId: z.string(),
  chapters: z.array(z.string()),
  status: z.enum(["initializing", "processing", "done"]),
});

// Chapter agent state
const ChapterState = new StateSchema({
  chapterId: z.string(),
  transcript: z.string(),
  summary: z.string(),
  beats: z.array(z.object({
    timestamp: z.number(),
    type: z.string(),
    description: z.string(),
    essential: z.boolean(),
  })),
});
```

### Reducers

For accumulating values across multiple nodes:

```typescript
import { ReducedValue } from "@langchain/langgraph";

const State = new StateSchema({
  items: new ReducedValue(
    z.array(z.string()).default(() => []),
    {
      inputSchema: z.array(z.string()),
      reducer: (x, y) => x.concat(y),
    }
  ),
});
```

### Persistence (Short-term Memory)

For thread-level persistence (conversations):

```typescript
import { MemorySaver } from "@langchain/langgraph";

const checkpointer = new MemorySaver();

const builder = new StateGraph(State);
const graph = builder.compile({ checkpointer });

// Invoke with thread_id for persistence
await graph.invoke(
  { messages: [{ role: "user", content: "hi!" }] },
  { configurable: { thread_id: "1" } }
);
```

### Production Persistence

Use database-backed checkpointer for production:

```typescript
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
// or PostgresSaver, RedisSaver, MongoDBSaver

const checkpointer = SqliteSaver.fromConnString("file:./checkpoints.db");
await checkpointer.setup();

const graph = builder.compile({ checkpointer });
```

### Store (Long-term Memory)

For cross-thread memory (user-specific data):

```typescript
import { InMemoryStore } from "@langchain/langgraph";

const store = new InMemoryStore();

const graph = builder.compile({
  checkpointer,
  store, // For long-term memory
});

// Access store in nodes
const node: GraphNode<typeof State> = async (state, config) => {
  const userId = config.configurable?.userId;
  const namespace = [userId, "memories"];
  const memories = await config.store?.search(namespace, {
    query: state.messages.at(-1)?.content,
    limit: 3,
  });
  return { ... };
};
```

## 3. Subgraphs and Multi-Agent Systems

### Subgraph Patterns

There are two ways to use subgraphs:

#### Pattern 1: Invoke a graph from a node (different state schemas)

Best for: Isolated contexts, different state schemas, clean context windows

```typescript
// Subagent has its own state
const ChapterState = new StateSchema({
  chapterId: z.string(),
  transcript: z.string(),
  analysis: z.string(),
});

const chapterGraph = new StateGraph(ChapterState)
  .addNode("analyze", (state) => {
    return { analysis: `Analysis of ${state.chapterId}` };
  })
  .compile();

// Parent graph invokes subagent from node
const MainState = new StateSchema({
  projectId: z.string(),
  chapters: z.array(z.object({
    id: z.string(),
    analysis: z.string(),
  })),
});

const processChapter: GraphNode<typeof MainState> = async (state) => {
  const chapter = state.chapters[0];
  const result = await chapterGraph.invoke({
    chapterId: chapter.id,
    transcript: getTranscript(chapter.id),
  });
  return { chapters: [{ id: chapter.id, analysis: result.analysis }] };
};
```

#### Pattern 2: Add graph as a node (shared state)

Best for: Multi-agent systems with shared message keys

```typescript
const State = new StateSchema({
  messages: MessagesValue,
});

// Subgraph uses same message channel
const subgraph = new StateGraph(State)
  .addNode("research", (state) => ({
    messages: [{ role: "ai", content: "Research results..." }],
  }))
  .compile();

// Add subgraph directly as a node
const builder = new StateGraph(State)
  .addNode("subgraph", subgraph)
  .addNode("synthesize", (state) => ({
    messages: [{ role: "ai", content: "Synthesized answer..." }],
  }))
  .compile();
```

### Multi-Agent Patterns for Video Editing

Based on LangChain's multi-agent documentation, these are the patterns relevant to our use case:

#### Pattern: Subagents (Orchestrator-Worker)

**Best for our use case** - Centralized coordinator spawns chapter-specific workers.

Key characteristics:
- Main agent (supervisor) coordinates subagents as tools
- All routing passes through the main agent
- Subagents are stateless (clean context each invocation)
- Supports parallel execution

```typescript
import { createAgent, tool } from "langchain";
import * as z from "zod";

// Create chapter-specific subagent
const chapterAgent = createAgent({
  model: "anthropic:claude-sonnet-4-20250514",
  tools: [transcriptTool, beatExtractionTool],
  prompt: "You are a video editing specialist for a single chapter...",
});

// Wrap as tool
const processChapter = tool(
  async ({ chapterId, transcript }) => {
    const result = await chapterAgent.invoke({
      messages: [{ role: "user", content: `Analyze chapter: ${transcript}` }]
    });
    return result.messages.at(-1)?.content;
  },
  {
    name: "process_chapter",
    description: "Analyze a single video chapter for beats and narrative",
    schema: z.object({
      chapterId: z.string(),
      transcript: z.string(),
    })
  }
);

// Main supervisor agent
const mainAgent = createAgent({
  model: "anthropic:claude-sonnet-4-20250514",
  tools: [processChapter, storyCohesionTool, exportTool],
  prompt: "You are a senior video editor coordinating chapter analysis...",
});

// In LangGraph
const State = new StateSchema({
  messages: MessagesValue,
  chapters: z.array(z.object({ id: z.string(), transcript: z.string() })),
  results: z.array(z.any()),
});

const dispatchChapters: GraphNode<typeof State> = async (state) => {
  // Process chapters in parallel using LangGraph Send API
  const results = await Promise.all(
    state.chapters.map(chapter => 
      processChapter.invoke({ chapterId: chapter.id, transcript: chapter.transcript })
    )
  );
  return { results };
};
```

#### Pattern: Custom Workflow

For complex video editing pipeline with deterministic + agentic steps:

```typescript
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";

const State = Annotation.Root({
  projectId: Annotation<string>(),
  chapters: Annotation<string[]>(),
  transcripts: Annotation<Record<string, string>>(),
  summaries: Annotation<Record<string, string>>(),
  beats: Annotation<Record<string, any[]>>(),
  finalResult: Annotation<any>(),
});

// Node 1: Deterministic - Transcribe all chapters
const transcribe = async (state: typeof State.State) => {
  const transcripts: Record<string, string> = {};
  for (const chapterId of state.chapters) {
    transcripts[chapterId] = await transcribeChapter(chapterId);
  }
  return { transcripts };
};

// Node 2: Paralleled agents - Analyze chapters
const analyzeChapters = async (state: typeof State.State) => {
  // Use Send API for parallel chapter processing
  const agents = state.chapters.map(chapterId => 
    new Send("chapterAgent", { chapterId, transcript: state.transcripts[chapterId] })
  );
  return [agents]; // Will be dispatched to chapterAgent node
};

// Node 3: Agent - Story cohesion check
const storyCohesion = async (state: typeof State.State) => {
  const agent = createAgent({
    model: "gemini:gemma-3-27b",
    tools: [],
    prompt: "Analyze story cohesion across chapters...",
  });
  const result = await agent.invoke({
    messages: [{ role: "user", content: JSON.stringify(state.summaries) }]
  });
  return { finalResult: result.messages.at(-1)?.content };
};

const workflow = new StateGraph(State)
  .addNode("transcribe", transcribe)
  .addNode("dispatchChapters", analyzeChapters)
  .addNode("chapterAgent", chapterAgentNode) // Receives from Send
  .addNode("storyCohesion", storyCohesion)
  .addEdge(START, "transcribe")
  .addEdge("transcribe", "dispatchChapters")
  .addConditionalEdges("dispatchChapters", (state) => {
    return state.chapters.map(chapterId => new Send("chapterAgent", { ... }));
  })
  .addEdge("chapterAgent", "storyCohesion")
  .addEdge("storyCohesion", END)
  .compile({
    checkpointer: new SqliteSaver("file:./checkpoints.db"),
  });
```

## 4. Streaming Implementation

### Stream Modes

- `updates`: Stream state updates after each node
- `values`: Stream full state after each node
- `messages`: Stream LLM tokens (for real-time feedback)
- `custom`: Send custom data from nodes (progress updates)
- `debug`: Maximum information for debugging

### Basic Streaming

```typescript
for await (const chunk of await graph.stream(
  { messages: [{ role: "user", content: "Analyze this video" }] },
  { streamMode: "updates" }
)) {
  console.log(chunk); // Node name and state update
}
```

### Stream LLM Tokens (Real-time AI output)

```typescript
for await (const [messageChunk, metadata] of await graph.stream(
  { messages: [...] },
  { streamMode: "messages" }
)) {
  if (messageChunk.content) {
    console.log(messageChunk.content); // Token by token
    // metadata.langgraph_node tells you which node sent this
    // metadata.tags helps filter by agent
  }
}
```

### Stream Subgraph Outputs

```typescript
for await (const chunk of await graph.stream(
  { foo: "input" },
  {
    streamMode: "updates",
    subgraphs: true, // Include subgraph outputs
  }
)) {
  // chunk format: [namespace, data]
  // namespace: ["parent_node:<task_id>", "child_node:<task_id>"]
  console.log(chunk);
}
```

### Custom Data Streaming (Progress Updates)

```typescript
import { LangGraphRunnableConfig } from "@langchain/langgraph";

const analyzeChapter: GraphNode<typeof State> = async (state, config) => {
  config.writer?.({ 
    type: "progress", 
    chapterId: state.chapterId,
    status: "transcribing",
    progress: 10,
  });
  
  const transcript = await transcribeChapter(state.chapterId);
  
  config.writer?.({ 
    type: "progress", 
    chapterId: state.chapterId,
    status: "analyzing",
    progress: 50,
  });
  
  const analysis = await analyzeTranscript(transcript);
  
  config.writer?.({ 
    type: "progress", 
    chapterId: state.chapterId,
    status: "complete",
    progress: 100,
  });
  
  return { analysis };
};

// In renderer (Electron)
for await (const chunk of await graph.stream(input, { streamMode: "custom" })) {
  updateUI(chunk); // Progress bars, status indicators
}
```

### Multiple Stream Modes

```typescript
for await (const [mode, chunk] of await graph stream(input, {
  streamMode: ["custom", "messages"],
})) {
  if (mode === "custom") updateProgress(chunk);
  if (mode === "messages") displayToken(chunk);
}
```

## 5. Provider Abstractions

### Base Provider Interface

```typescript
// src/providers/base.ts
export interface LLMProvider {
  chat(messages: Message[]): Promise<Message>;
  completion(prompt: string): Promise<string>;
  stream(messages: Message[]): AsyncGenerator<string>;
}

export class BaseLLM {
  constructor(
    public provider: LLMProvider,
    public model: string,
    public temperature: number = 0.7,
  ) {}

  async invoke(input: any): Promise<any> {
    // Standard invoke method
  }

  bindTools(tools: any[]): this {
    // Tool binding
    return this;
  }

  withStructuredOutput(schema: any): any {
    // Structured output wrapper
    return this;
  }
}
```

### Gemini Provider

```typescript
// src/providers/gemini.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { LLMProvider, BaseLLM } from "./base";

export class GeminiProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private model: string = "gemini-2.0-pro",
  ) {
    const client = new GoogleGenerativeAI(apiKey);
    this.genAI = client.getGenerativeModel({ model });
  }

  async chat(messages: any[]): Promise<any> {
    // Implement Gemini chat
  }

  async stream(messages: any[]): AsyncGenerator<string> {
    // Implement Gemini streaming
    const result = await this.genAI.generateContentStream(...);
    for await (const chunk of result.stream) {
      yield chunk.text();
    }
  }
}

export class GeminiLLM extends BaseLLM {
  constructor(apiKey: string, model: string) {
    super(new GeminiProvider(apiKey), model);
  }
}
```

### Provider Factory

```typescript
// src/providers/index.ts
export function createLLM(config: {
  provider: "gemini" | "openai" | "anthropic";
  apiKey: string;
  model?: string;
}): BaseLLM {
  const { provider, apiKey, model = "default" } = config;
  
  switch (provider) {
    case "gemini":
      return new GeminiLLM(apiKey, model || "gemini-2.0-pro");
    case "openai":
      return new OpenAILLM(apiKey, model || "gpt-4o");
    case "anthropic":
      return new AnthropicLLM(apiKey, model || "claude-sonnet-4");
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

## 6. Prompt Template Organization

```typescript
// src/prompts/narrative-analyze.ts
import { ChatPromptTemplate } from "@langchain/core/prompts";

export const NARRATIVE_ANALYSIS_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a senior video editor with expertise in narrative structure.

Your task is to analyze the transcript of a video chapter and identify:
1. Story beats (setup, escalation, twist, payoff, transition)
2. Character moments
3. Redundant or fluff content
4. Key visual moments that should be preserved

Output a JSON structure with:
- beats: array of {timestamp, type, description, essential}
- fluff: array of {start, end, reason}
- themes: array of key themes identified
`,
  ],
  ["human", "Analyze this transcript:\n\n{transcript}"],
]);

// src/prompts/beat-extraction.ts
export const BEAT_EXTRACTION_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `Extract essential narrative beats from this video chapter.

Beat types:
- SETUP: Introduction of characters, setting, or premise
- ESCALATION: Rising action, conflict, or tension building
- TWIST: Surprising revelation or turn of events
- PAYOFF: Resolution to setup, emotional climax
- TRANSITION: Bridge between scenes or points

Mark each beat as:
- essential: true for critical narrative elements
- optional: true for content that can be trimmed if needed
`,
  ],
  ["human", "Chapter {chapterId}:\n{transcript}"],
]);
```

## 7. Best Practices for Electron/Desktop Apps

### IPC Integration

```typescript
// In Electron main process
import { ipcMain } from "electron";
import { graph } from "./agent";

ipcMain.handle("agent:request", async (event, input, config) => {
  const threadId = config.threadId || generateId();
  
  // Stream updates to renderer
  const stream = graph.stream(input, {
    configurable: { thread_id: threadId },
    streamMode: ["custom", "messages"],
  });
  
  for await (const [mode, chunk] of await stream) {
    event.sender.send("agent:update", { mode, chunk, threadId });
  }
  
  const result = await graph.getState({ configurable: { thread_id: threadId } });
  return { result, threadId };
});
```

```typescript
// In Electron renderer process
const response = await ipcRenderer.invoke("agent:request", {
  messages: [{ role: "user", content: "Analyze this video" }],
});

ipcRenderer.on("agent:update", (event, { mode, chunk, threadId }) => {
  if (mode === "custom") {
    updateProgressBar(chunk);
  } else if (mode === "messages") {
    appendToChat(chunk);
  }
});
```

### Checkpointer with SQLite (Local-only)

```typescript
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import { app } from "electron";

// Store checkpoints in app data directory
const dbPath = path.join(app.getPath("userData"), "checkpoints.db");
const checkpointer = SqliteSaver.fromConnString(`file:${dbPath}`);
await checkpointer.setup();

const graph = builder.compile({ checkpointer });
```

### Store for Project Data

Track analysis results across sessions:

```typescript
import { InMemoryStore } from "@langchain/langgraph";
import { app } from "electron";

const store = new InMemoryStore();

// Store analysis by project
const saveAnalysis = async (projectId: string, analysis: any) => {
  await store.put(
    ["projects", projectId],
    "analysis",
    { data: analysis, updatedAt: new Date().toISOString() }
  );
};

// Load analysis
const loadAnalysis = async (projectId: string) => {
  const items = await store.search(["projects", projectId]);
  return items[items.length - 1]?.value?.data;
};
```

### Configuration

```typescript
// src/config.ts
export const CONFIG = {
  defaultModel: {
    provider: "gemini",
    model: "gemini-2.0-pro-vision-exp",
    temperature: 0.7,
  },
  transcription: {
    model: "whisper-large-v3",
    local: true, // Use local Whisper by default
  },
  persistence: {
    checkpointer: "sqlite", // or "postgres" for production
    store: "sqlite",
  },
};

// Read from Electron settings
const getUserSettings = () => {
  return {
    apiKey: localStorage.getItem("gemini_api_key"),
    preferredProvider: localStorage.getItem("llm_provider") || "gemini",
    // ...
  };
};
```

## 8. Recommended Architecture for VOD Pipeline

### Graph Structure

```
MainOrchestrator (StateGraph)
├── START
├── transcribe_node (deterministic)
│   └── Runs Whisper on all chapters
├── dispatch_chapters (conditional edge)
│   └── Creates ChapterSubgraph for each chapter
├── ChapterSubgraph (subgraph)
│   ├── narrative_analyze_node
│   ├── beat_extract_node
│   └── visual_verify_node (Gemini video API)
├── story_cohesion_node (agent)
│   ├── Analyzes all chapter summaries
│   ├── Finds callbacks and through-lines
│   └── Recommends chapter reordering
├── generate_exports_node (deterministic)
│   └── Generates XML/EDL exports
└── END
```

### State Schema

```typescript
const MainState = new StateSchema({
  projectId: z.string(),
  vodPath: z.string(),
  chapters: z.array(z.object({
    id: z.string(),
    start: z.number(),
    end: z.number(),
    transcript: z.string().optional(),
  })),
  transcripts: z.record(z.string()),
  chapterSummaries: z.record(z.string()),
  chapterBeats: z.record(
    z.array(z.object({
      timestamp: z.number(),
      type: z.enum(["setup", "escalation", "twist", "payoff", "transition"]),
      description: z.string(),
      essential: z.boolean(),
      visualVerified: z.boolean(),
    }))
  ),
  storyAnalysis: z.object({
    themes: z.array(z.string()),
    callbacks: z.array(z.object({
      setup: z.any(),
      payoff: z.any(),
    })),
    recommendations: z.string(),
  }).optional(),
  exports: z.record(z.string()), // XML, EDL, AAF
  messages: MessagesValue, // For chat interface
});

const ChapterState = new StateSchema({
  chapterId: z.string(),
  transcript: z.string(),
  summary: z.string().optional(),
  beats: z.array(z.any()).optional(),
  visualFrames: z.any().optional(), // For Gemini video analysis
});
```

### File Organization Recap

```
src/agent/
├── graphs/
│   ├── main-orchestrator.ts      # Main coordinator graph
│   ├── chapter-subgraph.ts       # Per-chapter analysis graph
│   ├── story-cohesion-graph.ts   # Meta-analysis graph
│   └── index.ts                  # Exports all graphs
├── nodes/
│   ├── transcription.ts
│   ├── narrative-analysis.ts
│   ├── beat-extraction.ts
│   ├── visual-verification.ts
│   ├── story-cohesion.ts
│   └── exports/
│       ├── xml-generator.ts
│       ├── edl-generator.ts
│       └── aaf-generator.ts
├── tools/
│   ├── video/
│   │   ├── ffmpeg.ts
│   │   ├── frame-extractor.ts
│   │   └── proxy-generator.ts
│   ├── transcript/
│   │   └── whisper.ts
│   └── ai/
│       ├── gemini-video.ts
│       └── structured-output.ts
├── prompts/
│   ├── narrative-analysis.ts
│   ├── beat-extraction.ts
│   ├── visual-verification.ts
│   └── story-cohesion.ts
├── providers/
│   ├── base.ts
│   ├── gemini.ts
│   ├── openai.ts
│   └── index.ts
├── state/
│   ├── schemas.ts
│   └── reducers.ts
├── utils/
│   ├── checkpoints.ts
│   └── store.ts
└── index.ts                      # Main export

src/electron/
├── main/
│   ├── agent-ipc.ts              # IPC handlers for agent
│   └── setup.ts
└── renderer/
    └── hooks/
        ├── useAgent.ts           # React hook for agent interaction
        └── useAgentStream.ts     # Hook for streaming updates
```

## Key Takeaways

1. **State-first design**: Define your state schemas first, then build graphs around them
2. **Subgraphs for isolation**: Use subgraphs for chapter agents to keep context clean
3. **Send API for parallelization**: Use `new Send()` for parallel chapter processing
4. **Streaming for UX**: Always stream progress and tokens for desktop apps
5. **Local persistence**: Use SQLite checkpointers for Electron apps
6. **Tool abstraction**: Wrap agents and operations as tools for composability
7. **Provider abstraction**: Design provider interfaces to swap LLM backends
8. **Custom data streaming**: Use `writer` for progress bars and status updates

## References

- [LangGraph JavaScript Docs](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [State Management](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)
- [Multi-Agent: Subagents](https://docs.langchain.com/oss/javascript/langchain/multi-agent/subagents)
- [Multi-Agent: Custom Workflow](https://docs.langchain.com/oss/javascript/langchain/multi-agent/custom-workflow)
- [Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [Application Structure](https://docs.langchain.com/oss/javascript/langgraph/application-structure)
