# Phase 3b/4 Implementation Plan: Source Tape Timeline with Visual AI

## Overview

Build a **DaVinci Resolve-style source tape timeline** where the full chapter is visible, cuts are highlighted sections, and greyed areas are excluded. AI collaborates with you through chat to suggest cuts, reviewing proxy video (640px, 5fps) and transcript before making decisions.

**Timeline:** 8 weeks total  
**Phase 3b:** 5 weeks (Timeline & Proxy System)  
**Phase 4:** 3 weeks (Visual AI Integration)

---

## Core Philosophy

**Simple rule:** Highlighted = exported, Greyed = excluded

**AI collaboration:** Discuss first, decide together, then apply

**Cost-efficient:** Low-res proxies for AI, high-res originals for export

---

## Database Schema

```sql
-- Original assets
CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  duration REAL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Low-res proxies for AI analysis
CREATE TABLE proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  preset TEXT,               -- 'ai_analysis', 'rough_cut', etc.
  resolution TEXT,
  framerate INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chapters (one chapter = one asset)
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  proxy_id INTEGER,          -- Which proxy for AI analysis
  title TEXT,
  start_time REAL,           -- Within asset (for partial chapters)
  end_time REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cuts (highlighted sections on timeline)
CREATE TABLE cuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  in_point REAL NOT NULL,    -- Start time in source
  out_point REAL NOT NULL,   -- End time in source
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Suggestions (autosaved, pending user approval)
CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  description TEXT,
  reasoning TEXT,            -- Why AI suggested this
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Timeline Behavior

### Display
- **Full chapter** shown as continuous waveform/video strip
- **Cuts** highlighted in color (single color, no roles)
- **Grey sections** at 30% opacity with diagonal hatching
- White drag handles at cut boundaries (IN/OUT points)

### Magnetism (Toggleable)
- **ON (default):** Prevents gaps < 0.1 seconds between cuts
- **OFF:** Free positioning, any gap size allowed
- Toggle button + `M` key shortcut

### Creating Cuts
- **AI:** Suggests cuts via chat, previews in suggestion panel
- **Manual:** Click grey section → Creates 5-second cut
- **Keyboard:** `I` (IN point), `O` (OUT point) at playhead

### Editing Cuts
- Drag IN/OUT handles to resize
- Drag cut body to move (weak magnetic push)
- `S` to split at playhead
- `Delete` to remove (becomes grey)
- Select multiple + `Shift+M` to merge

### Playhead
- **Normal:** Plays through everything
- **Skip Excluded (toggle):** Jumps over grey sections
- Toggle button + `\` key shortcut

---

## AI Workflow

### 1. Start Conversation
User opens chapter → Chat panel loads with initial context:
- Proxy video path (640px, 5fps, max 45 min)
- Full transcript
- Current timeline state (existing cuts)

### 2. Discussion
- User: "What should we keep?"
- AI: Reviews proxy video + transcript
- AI: "I suggest keeping 2:15-3:30 (setup), 5:30-6:15 (payoff), cutting 4:00-4:45 (inventory management)"
- User: "Show me 4:00"
- AI: [Watches that section] "45 seconds of UI clicking, no dialogue"
- User: "Cut it"
- AI: Adds suggestion to remove 4:00-4:45

### 3. Suggestion Panel
- Lists all pending suggestions
- Shows: time range, description, AI reasoning
- **Play button:** Preview just that segment
- **Edit handles:** Adjust IN/OUT points
- **Add/Remove:** Manual control

### 4. Apply to Timeline
- Click "Apply to Timeline"
- Converts suggestions → cuts in database
- Timeline refreshes immediately
- Can chat again to refine further

### 5. Export
- Exports only highlighted sections
- References original asset (high quality)
- Creates EDL/XML for NLE import

---

## Agent Context

**Thread Start Message:**
```typescript
{
  type: "start_thread",
  chapter: {
    id: string,
    proxy_path: string,      // 640px/5fps video file
    transcript: string,
    duration: number,
  },
  timeline_state: {
    current_cuts: Cut[],     // Empty on first analysis
    total_duration: number,
  }
}
```

**Agent Tools:**
- `get_timeline_state()` - Refresh current cuts/suggestions
- `get_transcript_segment(start, end)` - Get specific dialogue

**Agent Output:**
```json
{
  "analysis": "Chapter is about X. Key moments...",
  "suggestions": [
    {
      "in_point": 135.0,
      "out_point": 210.0,
      "description": "Setup and first attempt",
      "reasoning": "Establishes challenge, shows failure, builds tension"
    }
  ]
}
```

---

## Implementation Phases

### Phase 3b: Timeline Foundation (5 weeks)

#### Week 1: Proxy System
- FFmpeg proxy generation (640px, 5fps, H.264)
- Proxy presets: `AI_ANALYSIS`, `ROUGH_CUT`
- Proxy table operations
- Auto-generate on asset import
- Database migrations for proxy table

#### Week 2: Database & Schema
- Create cuts table (no roles)
- Drop beats/clips tables (migrate data if needed)
- Chapter → asset/proxy linking
- Cut CRUD operations
- Split/merge operations

#### Week 3: Source Tape Display
- WaveSurfer full chapter view
- Cut regions (single color)
- Grey section overlay (30% opacity + hatching)
- IN/OUT drag handles
- Time ruler
- Chapter selector component

#### Week 4: Cut Manipulation
- Click-to-create (5s default)
- IN/OUT keyboard shortcuts (`I`, `O`)
- Split (`S`) and merge
- Drag handles and cut movement
- Weak magnetism (< 0.1s gap prevention)
- Context menus

#### Week 5: Suggestion Preview Panel
- List suggestions from AI
- Play individual suggestions
- Edit IN/OUT boundaries
- Apply button (convert to cuts)
- Sync with timeline state

### Phase 4: Visual AI (3 weeks)

#### Week 1: Multimodal Agent
- Gemini integration (or other video-capable LLM)
- Send proxy video (max 45 min)
- Send transcript
- Initial context on thread start
- Frame extraction utilities (if needed)

#### Week 2: Conversational Workflow
- Chat interface with streaming
- Agent watches proxy, suggests cuts
- Suggestion panel sync
- Autosave suggestions to DB
- State context tool for agent
- Multiple suggestion rounds

#### Week 3: Refinement & Export
- Multiple analysis rounds
- Apply suggestions → cuts
- Timeline refresh
- Export cuts only (EDL/XML/JSON)
- Use original asset paths
- Integration tests

---

## UI Components

### Timeline.svelte
- Full chapter waveform
- Cut regions with handles
- Grey overlay
- Playhead
- Zoom/scroll

### CutHandle.svelte
- IN/OUT point drag handles
- Timecode tooltip

### TimelineToolbar.svelte
- Magnetism toggle
- Skip Excluded toggle
- Split/Merge buttons
- Zoom controls
- Chapter selector dropdown

### SuggestionPanel.svelte
- List of AI suggestions
- Play/Edit/Apply buttons
- Reasoning display

### ChatPanel.svelte
- Chat with agent
- Streaming responses
- Context-aware (current chapter)
- Quick action buttons

---

## Cost Optimization

**Proxy specs:** 640px width, 5fps, H.264
- **8-hour video:** ~100MB proxy vs ~8GB original
- **Gemini cost:** ~$0.10-0.30 per chapter vs $2-5 full-res
- **Savings:** 90-95%

---

## Success Criteria

- [ ] Proxies auto-generated on import (640px/5fps)
- [ ] Full chapter visible as source tape
- [ ] Cuts highlighted, grey sections excluded
- [ ] Weak magnetism prevents micro-gaps
- [ ] Click grey → Create 5s cut
- [ ] Drag handles adjust boundaries
- [ ] AI reviews proxy video + transcript
- [ ] Chat-based cut suggestions
- [ ] Suggestions autosaved per chapter
- [ ] Suggestion panel with preview
- [ ] Apply suggestions → timeline updates
- [ ] Multiple analysis rounds supported
- [ ] Export uses original asset (high quality)
- [ ] No role colors on cuts
- [ ] One chapter = one asset enforced

---

## Open Issues (Deferred)

**Long videos (45+ min):**
- Gemini limit is 45 minutes
- Solution: Chunk into segments, analyze sequentially, or use different model
- **Status:** Handle in future phase when needed

---

## File Structure

```
src/
├── renderer/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── Timeline.svelte
│   │   │   ├── CutHandle.svelte
│   │   │   ├── CutRegion.svelte
│   │   │   ├── GreyOverlay.svelte
│   │   │   ├── TimelineToolbar.svelte
│   │   │   ├── SuggestionPanel.svelte
│   │   │   ├── ChatPanel.svelte
│   │   │   └── ChapterSelector.svelte
│   │   └── state/
│   │       └── timeline.svelte.ts
├── electron/
│   ├── database/
│   │   └── db.ts
│   ├── ipc/
│   │   └── handlers.ts
│   └── main.ts
├── agent/
│   ├── graphs/
│   │   └── chapter-subgraph.ts
│   ├── prompts/
│   │   └── cut-suggestion.ts
│   └── tools/
│       ├── get-timeline-state.ts
│       └── get-transcript-segment.ts
├── pipeline/
│   ├── ffmpeg.ts              (proxy generation)
│   └── export/
│       ├── xml.ts
│       ├── json.ts
│       └── edl.ts
└── shared/
    └── types/
        └── database.ts
```

---

## Key Design Decisions

1. **Source tape model:** Full chapter visible, cuts as ranges, not discrete clips
2. **Weak magnetism:** Prevents micro-gaps only (< 0.1s)
3. **AI collaboration:** Chat first, suggestions, then apply
4. **No roles:** Single color for all cuts
5. **Proxy-only for AI:** 640px/5fps, never sees original
6. **One chapter = one asset:** Simplified data model
7. **Suggestions separate:** Autosaved but not applied until user confirms
8. **Visual + text:** AI watches proxy video and reads transcript

---

**Ready to begin implementation.**
