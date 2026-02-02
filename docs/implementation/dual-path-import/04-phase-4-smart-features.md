# Phase 4: Smart Features

## Tasks

### 12. Add Auto-Naming IPC Handler Using LLM on Transcript
**Priority:** Medium  
**Files:**
- `src/electron/ipc/handlers.ts` (new handler)
- `src/electron/ipc/channels.ts` (new channel)
- `src/electron/preload.ts` (expose to renderer)
- `src/agent/utils/chapter-naming.ts` (new utility)

**Purpose:** Automatically generate short, descriptive chapter titles by feeding the transcript to a cheap LLM.

**IPC Handler:**
```typescript
// New channel: CHAPTER_GENERATE_NAME
ipcMain.handle(IPC_CHANNELS.CHAPTER_GENERATE_NAME, async (_, { chapterId, model }) => {
  // 1. Get chapter transcript
  const transcripts = await getTranscriptsByChapter(chapterId);
  const fullText = transcripts.map(t => t.text).join(' ');
  
  // 2. Truncate to first ~2000 characters (cheap model context limit)
  const truncatedText = fullText.substring(0, 2000);
  
  // 3. Call LLM
  const prompt = `Generate a short, descriptive title (3-5 words) for this video chapter based on its transcript. Be concise and specific.

Transcript:
"${truncatedText}"

Title:`;

  const title = await callCheapLLM(prompt, model); // gpt-4o-mini, etc.
  
  // 4. Clean up title (remove quotes, trim, capitalize)
  const cleanTitle = cleanChapterTitle(title);
  
  // 5. Update chapter with new title
  await updateChapter(chapterId, { title: cleanTitle });
  
  return { success: true, title: cleanTitle };
});
```

**Settings Integration:**
```typescript
// Only auto-name if setting is enabled
if (settings.autoChapterNamingEnabled && hasTranscript) {
  await generateChapterName(chapter.id, settings.autoChapterNamingModel);
}
```

**When to Trigger:**
- After transcription completes (if setting enabled)
- Manual trigger via "Suggest Title" button in ChapterPanel

---

### 13. Support Multiple VODs Per Project (Chapter Grouping by Asset)
**Priority:** Medium  
**Files:**
- Already handled in Phase 3 (ChapterPanel grouping)
- `src/renderer/lib/state/chapters.svelte.ts` (ensure support)

**Current Architecture:**
- Chapters link to assets via many-to-many table
- One chapter can technically link to multiple assets
- But we treat each chapter as belonging to ONE primary asset (the first linked)

**Multiple VODs Support:**
Each VOD imported creates:
1. One asset record (the VOD file)
2. Multiple chapter records (segments of the VOD)
3. Each chapter linked to the VOD asset

**UI Grouping:**
Already implemented in Phase 3 - ChapterPanel groups by asset.

**Edge Cases:**
- What if user imports two VODs with overlapping chapter times? → Allowed, treat as separate streams
- Can chapters from different VODs be reordered together? → Yes, but UI keeps them in their groups
- Can chapters be moved between VODs? → Future feature, not in MVP

---

### 14. Update Transcription Flow for Per-Chapter Extraction
**Priority:** Medium  
**Files:**
- `src/electron/ipc/handlers.ts` - `TRANSCRIBE_CHAPTER` handler
- `src/pipeline/whisper.ts` (may need audio extraction)

**Current Flow:**
The `TRANSCRIBE_CHAPTER` handler already:
1. Gets assets for chapter (uses first one)
2. Extracts audio from asset
3. Runs Whisper
4. Saves transcripts

**Problem:** It extracts audio from the FULL asset, not just the chapter segment.

**Required Change:** Extract only the chapter's time segment.

```typescript
// In TRANSCRIBE_CHAPTER handler
const chapter = await getChapter(chapterId);
const assetIds = await getAssetsForChapter(chapterId);
const asset = await getAsset(assetIds[0]);

// Extract audio segment instead of full audio
const segmentDuration = chapter.end_time - chapter.start_time;
const tempAudioPath = await extractAudioSegment(
  asset.file_path,
  chapter.start_time,
  segmentDuration,
  tempDir
);

// Transcribe the segment
const transcript = await transcribe(tempAudioPath, {
  offset: chapter.start_time, // Add offset to timestamps
  ...options
});
```

**FFmpeg Command:**
```bash
ffmpeg -i input.mp4 -ss START_TIME -t DURATION -vn -acodec pcm_s16le -ar 16000 -ac 1 output.wav
```

**Timestamp Offset:**
When saving transcripts, add `chapter.start_time` to each segment's timestamps so they reflect absolute position in the VOD.

```typescript
// Adjust timestamps
const adjustedTranscript = transcript.segments.map(seg => ({
  ...seg,
  start: seg.start + chapter.start_time,
  end: seg.end + chapter.start_time
}));
```

---

### 15. Update BeatPanel to Show Beats for Selected Chapter
**Priority:** Medium  
**Files:**
- `src/renderer/lib/components/BeatPanel.svelte`
- `src/electron/ipc/handlers.ts` (add beats handler if needed)
- `src/electron/database/db.ts` (add beats query)

**Current State:**
BeatPanel shows `clips` passed as prop. Need to add support for showing `beats` for a chapter.

**Database Query:**
```typescript
// In db.ts
export async function getBeatsByChapter(chapterId: number): Promise<Beat[]> {
  const database = await getDatabase();
  return database.prepare(
    'SELECT * FROM beats WHERE chapter_id = ? ORDER BY start_time'
  ).all(chapterId) as Beat[];
}
```

**IPC Handler:**
```typescript
// New channel: BEAT_GET_BY_CHAPTER
ipcMain.handle(IPC_CHANNELS.BEAT_GET_BY_CHAPTER, async (_, { chapterId }) => {
  const beats = await getBeatsByChapter(chapterId);
  return createSuccessResponse(beats);
});
```

**Updated BeatPanel Props:**
```typescript
interface Props {
  // Either chapterId OR clips
  chapterId?: number;
  clips?: Clip[];
}
```

**Component Logic:**
```svelte
<script>
  let { chapterId, clips }: Props = $props();
  
  // Load beats if chapterId provided
  let beats = $state<Beat[]>([]);
  
  $effect(() => {
    if (chapterId) {
      loadBeatsForChapter(chapterId);
    }
  });
  
  async function loadBeatsForChapter(id: number) {
    const result = await window.electronAPI.beats.getByChapter(id);
    if (result.success) {
      beats = result.data || [];
    }
  }
</script>

{#if chapterId}
  <!-- Show beats -->
  <BeatsList {beats} />
{:else if clips}
  <!-- Show clips (existing behavior) -->
  <ClipsList {clips} />
{/if}
```

**Integration with AI:**
When AI analyzes a chapter:
1. Agent generates beats via `analyze-chapters`
2. Beats saved to database with `chapter_id`
3. BeatPanel displays them
4. User can convert beats to timeline clips

---

## Technical Considerations

### Auto-Naming Cost Control
- Only auto-name chapters > 30 seconds (skip short clips)
- Use cheapest available model (GPT-4o mini = $0.15/1M input tokens)
- Cache results to avoid re-generating
- Allow manual override (user can always edit title)

### Transcription Performance
- Per-chapter extraction is slower than full-VOD (multiple Whisper runs)
- But allows parallel processing of chapters
- Consider batching or queue system for many chapters

### Beats vs Clips
- **Beats:** AI-suggested narrative moments (not on timeline yet)
- **Clips:** User-approved segments on the timeline
- Workflow: Beats → User Review → Clips → Export

---

## Dependencies Between Tasks

```
Task 12 (Auto-naming) ───────────────────┐
                                         ├──→ Task 15 (BeatPanel)
Task 14 (Transcription) ─────────────────┤
                                         │
Task 13 (Multiple VODs) ─────────────────┘ (UI already done in Phase 3)
```

Task 15 depends on Task 14 because beats reference transcript timestamps.

---

## Success Criteria

- [ ] Auto-naming generates sensible titles from transcripts
- [ ] Auto-naming respects the enable/disable setting
- [ ] Can manually trigger title generation via button
- [ ] Multiple VODs appear as separate groups in ChapterPanel
- [ ] Each chapter's transcript covers only its time range
- [ ] Transcript timestamps are absolute (match VOD position)
- [ ] BeatPanel shows beats when chapter selected
- [ ] Beats have narrative roles (setup, payoff, etc.)
- [ ] Can convert beats to timeline clips
- [ ] AI analysis populates beats for chapters
