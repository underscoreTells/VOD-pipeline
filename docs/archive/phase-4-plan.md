# Phase 4 Implementation Plan: Visual AI Integration (Video-Native Only)

## Overview

Enable AI agents to watch low-resolution proxy videos natively and collaborate via chat to suggest cuts. Supports multiple video-capable LLM providers that can ingest video files directly—no frame extraction needed.

**Timeline:** 3-4 weeks  
**Dependencies:** Phase 3a (Core Video Processing) and Phase 3b (Timeline Editor) complete

**Core Philosophy:**
- AI watches proxy video (640px, 5fps) natively—90% cost savings vs full-res
- Video-native providers only (Gemini, Kimi K2.5)—no frame extraction
- Chat-based collaboration with provider switching
- Suggestions autosaved but user controls when to apply
- Source tape model—full chapter visible, cuts are highlighted ranges

---

## Supported Video-Native Providers

| Provider | Video Input Method | API Type | LangChain Support |
|----------|-------------------|----------|-------------------|
| **Gemini** | File path (direct) | `fileData` | ✅ `@langchain/google-genai` |
| **Kimi K2.5** | Base64-encoded MP4 | `video_url` | ❌ Custom implementation needed |

**Both providers:**
- Ingest full video files natively (no frame extraction)
- Support up to ~45-60 minute videos
- Return natural language analysis + structured suggestions

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Chat Interface with Provider Selector                      │
│  ─────────────────────────────────────────────────────────  │
│  [Gemini ▼] "What should we keep?"                         │
│  AI reviews proxy + transcript → suggests cuts             │
│  User switches provider → Different AI analyzes            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Proxy path + transcript + provider choice
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent Worker Process                                       │
│  ─────────────────────────────────────────────────────────  │
│  1. Load proxy video (640px, 5fps)                         │
│  2. Format video for selected provider:                    │
│     - Gemini: Send file path directly                      │
│     - Kimi: Base64 encode → send as video_url             │
│  3. Send video + transcript to LLM                         │
│  4. Stream response to UI                                  │
│  5. Parse & save suggestions                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Suggestions
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Suggestion Panel → Timeline                               │
│  ─────────────────────────────────────────────────────────  │
│  - Preview suggestions                                     │
│  - Edit IN/OUT boundaries                                  │
│  - Apply → Creates cuts on timeline                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Task Breakdown

### Task 4.1: Proxy Video Generation System

**Files:**
- `src/pipeline/ffmpeg.ts` - Add proxy generation
- `src/electron/database/db.ts` - Proxy CRUD operations
- `database/schema.sql` - Proxy table

**Proxy Specifications:**
- **AI Analysis Proxy:** 640px width (maintain aspect), 5fps, H.264, AAC audio
- **Max duration:** Full chapter (Gemini ~60 min, Kimi ~45 min limit)
- **File size:** ~50MB for 1-hour video

**Functions:**
```typescript
// src/pipeline/ffmpeg.ts
export async function generateAIProxy(
  inputPath: string, 
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<void>

export async function ensureProxyExists(
  assetId: number,
  onProgress?: (percent: number) => void
): Promise<string>  // Returns proxy path
```

**Database Schema:**
```sql
CREATE TABLE proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  preset TEXT NOT NULL CHECK(preset IN ('ai_analysis')),
  width INTEGER,
  height INTEGER,
  framerate INTEGER,
  file_size INTEGER,
  duration REAL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'ready', 'error')),
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX idx_proxies_asset_id ON proxies(asset_id);
CREATE INDEX idx_proxies_status ON proxies(status);
```

**Milestone:** Proxies auto-generate (640px/5fps) and stored in database

---

### Task 4.2: Kimi K2.5 Provider Implementation

**New File:** `src/agent/providers/kimi.ts`

**Why custom implementation:**
- LangChain has no official Moonshot AI integration
- Video input uses different format than Gemini

**Implementation:**
```typescript
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

export class KimiChatModel extends BaseChatModel {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  
  constructor(fields: { apiKey: string; model?: string }) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.model = fields.model || 'kimi-k2.5';
    this.baseUrl = 'https://api.moonshot.cn/v1';
  }
  
  async _generate(messages: BaseMessage[], options: any): Promise<ChatResult> {
    // Convert LangChain messages to Moonshot format
    // Handle video content specially
    // Make HTTP request to Moonshot API
    // Parse response
  }
  
  // Required abstract methods
  _llmType(): string { return 'kimi'; }
  _combineLLMOutput(): never { return undefined as never; }
}
```

**Video Message Format:**
```typescript
// For video messages, encode file to base64
const videoBase64 = await readFileAsBase64(videoPath);

const message = {
  role: 'user',
  content: [
    { type: 'text', text: prompt },
    {
      type: 'video_url',
      video_url: {
        url: `data:video/mp4;base64,${videoBase64}`
      }
    }
  ]
};
```

**Provider Registration:** `src/agent/providers/index.ts`
```typescript
export function createLLM(
  provider: 'gemini' | 'openai' | 'anthropic' | 'kimi',
  config: LLMConfig
): BaseChatModel {
  switch (provider) {
    case 'gemini':
      return new ChatGoogleGenerativeAI({...});
    case 'kimi':
      return new KimiChatModel({ apiKey: config.apiKey });
    // ... other providers
  }
}

export const VIDEO_CAPABLE_PROVIDERS = ['gemini', 'kimi'] as const;
```

**Milestone:** Kimi provider works, can send video + text

---

### Task 4.3: Video Message Formatter

**New File:** `src/agent/utils/video-messages.ts`

**Purpose:** Normalize video content across different providers

```typescript
export interface VideoContent {
  type: 'video';
  path: string;
  mimeType: string;
}

export async function createVideoMessage(
  provider: 'gemini' | 'kimi',
  textPrompt: string,
  videoPath: string
): Promise<HumanMessage> {
  switch (provider) {
    case 'gemini':
      // Gemini can reference file directly
      return new HumanMessage({
        content: [
          { type: 'text', text: textPrompt },
          {
            type: 'media',
            mimeType: 'video/mp4',
            fileData: { filePath: videoPath }
          }
        ]
      });
      
    case 'kimi':
      // Kimi needs base64-encoded video
      const base64Video = await readFileAsBase64(videoPath);
      return new HumanMessage({
        content: [
          { type: 'text', text: textPrompt },
          {
            type: 'video_url',
            video_url: {
              url: `data:video/mp4;base64,${base64Video}`
            }
          }
        ]
      });
  }
}

async function readFileAsBase64(filePath: string): Promise<string> {
  const buffer = await fs.promises.readFile(filePath);
  return buffer.toString('base64');
}
```

**Optimization:** For large videos (>50MB), consider:
- Temporary base64 caching
- Stream encoding for Kimi
- Progress callback during encoding

**Milestone:** Video content formatted correctly for each provider

---

### Task 4.4: Suggestion Database Schema

**File:** `database/schema.sql`

**New Table:**
```sql
CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  description TEXT,
  reasoning TEXT,  -- Why AI suggested this
  provider TEXT,   -- Which LLM generated this ('gemini', 'kimi')
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected')),
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE INDEX idx_suggestions_chapter_id ON suggestions(chapter_id);
CREATE INDEX idx_suggestions_status ON suggestions(status);
CREATE INDEX idx_suggestions_provider ON suggestions(provider);
```

**Database Operations:** `src/electron/database/db.ts`
```typescript
export async function createSuggestion(suggestion: SuggestionInput): Promise<number>
export async function getSuggestionsByChapter(chapterId: number, status?: string): Promise<Suggestion[]>
export async function getSuggestionsByProvider(chapterId: number, provider: string): Promise<Suggestion[]>
export async function applySuggestion(id: number): Promise<void>
export async function rejectSuggestion(id: number): Promise<void>
export async function clearPendingSuggestions(chapterId: number): Promise<void>
```

**Milestone:** Suggestions persist with provider attribution

---

### Task 4.5: Visual Analysis Chat Node

**File:** `src/agent/graphs/main-orchestrator.ts`

**New Node:** `visualAnalysisNode`

**Flow:**
```
chat_node → router → visual_analysis_node (if current chapter + video intent)
                → chapter_analysis (if explicit trigger)
                → chat_node (default text chat)
```

**Implementation:**
```typescript
interface VisualAnalysisInput {
  chapterId: string;
  provider: 'gemini' | 'kimi';
  userMessage: string;
  transcript: string;
}

async function visualAnalysisNode(state: MainState, config: RunnableConfig) {
  const chapterId = state.currentChapterId;
  const provider = state.selectedProvider; // From UI state
  
  // 1. Get chapter with proxy
  const chapter = await getChapterWithProxy(chapterId);
  if (!chapter.proxyPath) {
    throw new Error('Proxy not ready');
  }
  
  // 2. Get transcript
  const transcript = await getTranscriptByChapter(chapterId);
  
  // 3. Format message for selected provider
  const message = await createVideoMessage(
    provider,
    buildVisualAnalysisPrompt(state.messages[state.messages.length - 1].content, transcript),
    chapter.proxyPath
  );
  
  // 4. Send to LLM with streaming
  const llm = createLLM(provider, { apiKey: getApiKey(provider) });
  const response = await llm.invoke([message], { callbacks: [streamingCallback] });
  
  // 5. Parse suggestions from response
  const suggestions = extractSuggestionsFromResponse(response.content);
  
  // 6. Save to database with provider attribution
  for (const suggestion of suggestions) {
    await createSuggestion({
      chapter_id: chapterId,
      in_point: suggestion.inPoint,
      out_point: suggestion.outPoint,
      description: suggestion.description,
      reasoning: suggestion.reasoning,
      provider: provider
    });
  }
  
  // 7. Update state
  return {
    ...state,
    messages: [...state.messages, new AIMessage(response.content)],
    suggestions: [...(state.suggestions || []), ...suggestions]
  };
}
```

**Prompt Template:** `src/agent/prompts/visual-analysis.ts`
```typescript
export function buildVisualAnalysisPrompt(userQuestion: string, transcript: string): string {
  return `You are a professional video editor analyzing a video chapter.

Transcript:
${transcript}

User question: ${userQuestion}

Watch the video and analyze both visual content and dialogue. Identify:
1. Sections to KEEP (essential content, key moments, visual interest)
2. Sections to CUT (dead air, repetitive content, off-topic)

For each suggestion, provide:
- Time range (start → end in seconds)
- Brief description
- Reasoning (why keep or cut)

Format suggestions as:
SUGGESTION: {"in_point": 120.5, "out_point": 180.0, "description": "Setup scene", "reasoning": "Establishes challenge"}

Be concise and actionable.`;
}
```

**Milestone:** Agent analyzes video via chat, saves suggestions

---

### Task 4.6: Chat Panel with Provider Switching

**New File:** `src/renderer/lib/components/ChatPanel.svelte`

**Features:**
- Provider selector dropdown (Gemini, Kimi)
- Chat history with streaming
- Quick action buttons:
  - "Analyze this chapter"
  - "What should we cut?"
  - "Find the best moments"
- Typing indicator
- Message timestamps
- Context indicator (current chapter)

**Provider Selector:**
```svelte
<select bind:value={selectedProvider}>
  {#each VIDEO_CAPABLE_PROVIDERS as provider}
    <option value={provider}>{getProviderLabel(provider)}</option>
  {/each}
</select>
```

**State Integration:** `src/renderer/lib/state/agent.svelte.ts`
```typescript
export const agentState = $state({
  messages: [] as ChatMessage[],
  suggestions: [] as Suggestion[],
  selectedProvider: 'gemini' as VideoProvider,
  isStreaming: false,
  error: null as string | null
});

export async function sendChatMessage(message: string) {
  agentState.isStreaming = true;
  try {
    const response = await electronAPI.agent.chat({
      message,
      provider: agentState.selectedProvider,
      chapterId: projectState.currentChapterId
    });
    // Handle streaming...
  } finally {
    agentState.isStreaming = false;
  }
}

export async function loadSuggestions(chapterId: number) {
  agentState.suggestions = await electronAPI.agent.getSuggestions(chapterId);
}
```

**IPC Channels:**
- `agent:chat` - Send message with provider + chapter
- `agent:stream` - Receive streaming response
- `agent:get-suggestions` - Load current suggestions
- `agent:switch-provider` - Change active provider

**Milestone:** Full chat UI with provider switching

---

### Task 4.7: Suggestion Panel UI

**New File:** `src/renderer/lib/components/SuggestionPanel.svelte`

**Features:**
- Group suggestions by provider (Gemini vs Kimi)
- Show AI reasoning for each
- Time range with edit handles
- **Play button** - Preview that segment (loops)
- **Apply button** - Convert to cut
- **Reject button** - Remove suggestion
- **Apply All** - Batch apply

**Layout:**
```svelte
<div class="suggestion-panel">
  <h3>Suggestions</h3>
  
  {#each groupByProvider(suggestions) as [provider, providerSuggestions]}
    <div class="provider-group">
      <h4>{getProviderLabel(provider)}</h4>
      {#each providerSuggestions as suggestion}
        <div class="suggestion-card">
          <div class="time-range">
            {formatTime(suggestion.in_point)} → {formatTime(suggestion.out_point)}
          </div>
          <div class="description">{suggestion.description}</div>
          <div class="reasoning">{suggestion.reasoning}</div>
          <div class="actions">
            <button on:click={() => previewSuggestion(suggestion)}>▶ Preview</button>
            <button on:click={() => applySuggestion(suggestion)}>✓ Apply</button>
            <button on:click={() => rejectSuggestion(suggestion)}>✕ Reject</button>
          </div>
        </div>
      {/each}
    </div>
  {/each}
</div>
```

**Integration with Timeline:**
- Click suggestion → Scroll timeline to position
- Apply suggestion → Refresh timeline, new cut appears
- Preview suggestion → Playhead jumps, loops segment

**Milestone:** Can view, preview, and apply suggestions

---

### Task 4.8: Auto-Proxy Generation

**File:** `src/electron/ipc/handlers.ts`

**Trigger Points:**
1. **On asset import** (background job)
2. **When chapter opened for analysis** (if not exists)
3. **Manual generation** ("Generate Proxy" button)

**Handler:** `ASSET_IMPORT`
```typescript
ipcMain.handle(IPC_CHANNELS.ASSET_ADD, async (event, assetData) => {
  // 1. Create asset record
  const asset = await createAsset(assetData);
  
  // 2. Start proxy generation in background (don't await)
  generateProxyAsync(asset.id, asset.file_path);
  
  return asset;
});

async function generateProxyAsync(assetId: number, sourcePath: string) {
  const proxyPath = getProxyPath(assetId);
  
  // Update status to generating
  await updateProxyStatus(assetId, 'generating');
  
  try {
    await generateAIProxy(sourcePath, proxyPath, (progress) => {
      mainWindow.webContents.send('proxy:progress', { assetId, progress });
    });
    
    await createProxyRecord(assetId, proxyPath, 'ai_analysis');
    mainWindow.webContents.send('proxy:complete', { assetId });
  } catch (error) {
    await updateProxyStatus(assetId, 'error', error.message);
    mainWindow.webContents.send('proxy:error', { assetId, error: error.message });
  }
}
```

**Progress UI:**
- Show proxy generation progress in asset list
- Disable "Analyze" button until proxy ready
- Show estimated time: ~2-3 min for 1-hour video

**Milestone:** Proxies auto-generate when assets imported

---

### Task 4.9: Apply Suggestions to Timeline

**Integration Points:**

**When user clicks "Apply":**
```typescript
async function applySuggestion(suggestion: Suggestion) {
  // 1. Create cut in database
  const cut = await createCut({
    chapter_id: suggestion.chapter_id,
    in_point: suggestion.in_point,
    out_point: suggestion.out_point,
    description: suggestion.description,
    created_from_suggestion_id: suggestion.id
  });
  
  // 2. Mark suggestion as applied
  await markSuggestionApplied(suggestion.id);
  
  // 3. Refresh timeline state
  await timelineState.loadTimeline(projectState.projectId);
  
  // 4. Jump playhead to new cut
  timelineState.setPlayhead(suggestion.in_point);
}
```

**IPC Handlers:**
```typescript
ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY, async (event, suggestionId) => {
  const suggestion = await getSuggestion(suggestionId);
  const cut = await createCutFromSuggestion(suggestion);
  await applySuggestion(suggestionId);
  return cut;
});

ipcMain.handle(IPC_CHANNELS.SUGGESTION_REJECT, async (event, suggestionId) => {
  await rejectSuggestion(suggestionId);
});

ipcMain.handle(IPC_CHANNELS.SUGGESTION_APPLY_ALL, async (event, chapterId) => {
  const suggestions = await getPendingSuggestions(chapterId);
  for (const suggestion of suggestions) {
    await createCutFromSuggestion(suggestion);
    await applySuggestion(suggestion.id);
  }
});
```

**Milestone:** Clicking "Apply" creates cuts immediately

---

### Task 4.10: Settings & API Key Management

**New File:** `src/renderer/lib/components/SettingsPanel.svelte`

**Provider Configuration:**
```svelte
<section class="provider-settings">
  <h3>AI Providers</h3>
  
  <div class="provider-config">
    <label>Gemini API Key</label>
    <input 
      type="password" 
      bind:value={settings.geminiApiKey}
      placeholder="AIza..."
    />
    <button on:click={() => testProvider('gemini')}>Test</button>
  </div>
  
  <div class="provider-config">
    <label>Moonshot AI API Key (Kimi)</label>
    <input 
      type="password" 
      bind:value={settings.kimiApiKey}
      placeholder="sk-..."
    />
    <button on:click={() => testProvider('kimi')}>Test</button>
  </div>
  
  <div class="default-provider">
    <label>Default Video Provider</label>
    <select bind:value={settings.defaultVideoProvider}>
      {#each VIDEO_CAPABLE_PROVIDERS as provider}
        <option value={provider}>{getProviderLabel(provider)}</option>
      {/each}
    </select>
  </div>
</section>
```

**Settings Storage:**
- Store in `localStorage` or Electron's `app.getPath('userData')`
- Encrypt API keys at rest
- Validate keys on save

**Milestone:** Users can configure both providers, set defaults

---

## File Structure

```
src/
├── agent/
│   ├── providers/
│   │   ├── index.ts                  (UPDATE: add Kimi)
│   │   ├── gemini.ts                 (UPDATE: ensure video support)
│   │   ├── kimi.ts                   (NEW: Moonshot AI provider)
│   │   ├── openai.ts                 (existing - text only)
│   │   └── anthropic.ts              (existing - text only)
│   ├── utils/
│   │   └── video-messages.ts         (NEW: format video for providers)
│   ├── prompts/
│   │   └── visual-analysis.ts        (NEW: video analysis prompts)
│   └── graphs/
│       └── main-orchestrator.ts      (UPDATE: add visualAnalysisNode)
│
├── electron/
│   ├── database/
│   │   └── db.ts                     (UPDATE: proxy & suggestion CRUD)
│   └── ipc/
│       ├── channels.ts               (UPDATE: new channels)
│       └── handlers.ts               (UPDATE: proxy & suggestion handlers)
│
├── pipeline/
│   └── ffmpeg.ts                     (UPDATE: proxy generation)
│
├── renderer/
│   └── lib/
│       ├── components/
│       │   ├── ChatPanel.svelte      (NEW)
│       │   ├── SuggestionPanel.svelte (NEW)
│       │   ├── SettingsPanel.svelte  (NEW)
│       │   └── ProjectDetail.svelte  (UPDATE: integrate chat + suggestions)
│       └── state/
│           ├── agent.svelte.ts       (UPDATE: provider switching, suggestions)
│           └── settings.svelte.ts    (NEW: API key management)
│
database/
└── schema.sql                        (UPDATE: proxies & suggestions tables)
```

---

## Database Migrations

```sql
-- Proxy videos for AI analysis
CREATE TABLE proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  preset TEXT NOT NULL CHECK(preset IN ('ai_analysis')),
  width INTEGER,
  height INTEGER,
  framerate INTEGER,
  file_size INTEGER,
  duration REAL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'ready', 'error')),
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

-- AI cut suggestions
CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  description TEXT,
  reasoning TEXT,
  provider TEXT,  -- 'gemini' or 'kimi'
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected')),
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_proxies_asset_id ON proxies(asset_id);
CREATE INDEX idx_proxies_status ON proxies(status);
CREATE INDEX idx_suggestions_chapter_id ON suggestions(chapter_id);
CREATE INDEX idx_suggestions_status ON suggestions(status);
CREATE INDEX idx_suggestions_provider ON suggestions(provider);
```

---

## Success Criteria

- [ ] Proxies auto-generate on import (640px/5fps)
- [ ] Kimi K2.5 provider implemented with video support
- [ ] Gemini provider confirmed working with video
- [ ] Can switch providers in chat interface
- [ ] Agent analyzes video natively (no frame extraction)
- [ ] Chat responses stream in real-time
- [ ] Suggestions saved with provider attribution
- [ ] Suggestion panel displays AI reasoning
- [ ] Can preview individual suggestions
- [ ] Can edit suggestion IN/OUT points
- [ ] Clicking "Apply" creates cuts on timeline immediately
- [ ] Settings panel manages both API keys
- [ ] Cost savings: 90%+ vs full-res analysis

---

## Cost Analysis

**Proxy Generation (one-time, local):**
- 1-hour video → ~50MB proxy
- FFmpeg processing: ~3 minutes
- Cost: $0 (local compute)

**AI Analysis (per chapter):**
- Full-res video (1080p/30fps): ~$2-5 per hour
- Proxy video (640px/5fps): ~$0.10-0.30 per hour
- **Savings: 90-95%**

**Provider Comparison:**
- Gemini: ~$0.10-0.15/hour (cheapest, slightly lower quality)
- Kimi K2.5: ~$0.20-0.30/hour (better reasoning, more expensive)
- User can choose based on preference/budget

**Example 3-hour VOD:**
- Full-res with Gemini: ~$0.30-0.45
- Proxy with Gemini: ~$0.03-0.05
- Multiple analysis rounds: Savings compound

---

## Open Issues (Deferred)

**Long videos (>45-60 min):**
- Kimi limit: ~45 minutes
- Gemini limit: ~60 minutes
- Options for future:
  1. Split into chunks with overlap
  2. Analyze only key segments
  3. Use different model with longer context
- **Status:** Handle in future phase when needed

**Video encoding performance:**
- Kimi requires base64 encoding (increases memory usage)
- For 50MB proxy: ~67MB base64 string
- Potential optimization: Stream encoding or chunked upload
- **Status:** Current approach acceptable for 640px proxies

**API key security:**
- Keys stored locally, encrypted at rest
- Future: Keychain integration (macOS), Credential Manager (Windows)
- **Status:** Basic encryption sufficient for MVP

---

## Integration Summary

**Dependencies from Phase 3:**
- ✅ FFmpeg wrapper (proxy generation)
- ✅ Database layer (extend for proxies/suggestions)
- ✅ Timeline editor (apply suggestions → cuts)
- ✅ Agent foundation (extend with video nodes)

**New Components:**
- Kimi provider (custom implementation)
- Video message formatter (provider-specific)
- Chat panel (with provider switching)
- Suggestion panel (preview/apply workflow)
- Settings panel (API key management)

**Ready to Implement:**
All components have clear specifications and integration points. Plan is ready for development.
