# Phase 2: Import Flows

## Tasks

### 5. Build ImportChoice Component
**Priority:** High  
**File:** `src/renderer/lib/components/ImportChoice.svelte` (new file)

Component displayed when project is empty. Shows two import options.

**UI Design:**
```
┌─────────────────────────────────────┐
│     How would you like to start?    │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │      📹 Import Full VOD     │   │
│  │                             │   │
│  │  Import a single large      │   │
│  │  video file and manually    │   │
│  │  define chapters            │   │
│  │                             │   │
│  │  [Browse...]                │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │    📁 Import Individual     │   │
│  │         Files               │   │
│  │                             │   │
│  │  Import pre-cut video       │   │
│  │  files as chapters          │   │
│  │  (each file = 1 chapter)    │   │
│  │                             │   │
│  │  [Drop files here or        │   │
│  │   click to browse]          │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

**Props:**
```typescript
interface Props {
  projectId: number;
  onVODImport: (filePath: string) => void;
  onFilesImport: (filePaths: string[]) => void;
}
```

**Implementation Notes:**
- Use existing drag-and-drop patterns from ProjectDetail
- Use Electron's dialog for file picking
- Validate files are videos
- Call `chaptersState.importChoice = 'vod'` or `'files'`

---

### 6. Create ChapterDefinition Component
**Priority:** High  
**File:** `src/renderer/lib/components/ChapterDefinition.svelte` (new file)

Timeline scrubber interface for defining chapters from a full VOD.

**UI Design:**
```
┌─────────────────────────────────────────────────────────────┐
│ Define Chapters - vod_001.mp4 (Duration: 2:34:18)           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [TIMELINE SCRUBBER - Reuse existing waveform/timeline]     │
│  ┌───────────────────────────────────────────────────────┐ │
│  │≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈│ │
│  │       ▲                                               │ │
│  │       │ Playhead (0:00)                               │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  [Mark Start @ 0:00] [Mark End] [Preview] [Clear Markers]  │
│                                                             │
│  Current Selection: 0:00 - 0:00 (0s)                       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Defined Chapters:                                           │
│                                                             │
│  1. Chapter 1 (0:00 - 15:30)                               │
│     [Edit] [Delete] [Transcribe]                           │
│                                                             │
│  2. Chapter 2 (15:30 - 42:15) ⬅️ Current                   │
│     [Edit] [Delete] [Transcribe]                           │
│                                                             │
│  [+ Add Chapter from Selection]                            │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [Back]                                      [Create All ➔] │
└─────────────────────────────────────────────────────────────┘
```

**State Management:**
```typescript
// Local state (not saved to DB until "Create All")
let draftChapters: DraftChapter[] = [];
let currentSelection = { start: 0, end: 0 };
let playheadTime = 0;
```

**Props:**
```typescript
interface Props {
  asset: Asset;              // The VOD asset
  onComplete: (chapters: CreateChapterInput[]) => void;
  onCancel: () => void;
}
```

**Features:**
- Timeline with waveform visualization (reuse existing components)
- Playhead scrubbing (click or drag)
- "Mark Start" button sets selection start to playhead
- "Mark End" button sets selection end to playhead
- "Add Chapter" creates draft chapter from selection
- List of draft chapters with edit/delete
- "Create All" button calls `onComplete` with all chapters

---

### 7. Implement Chapter Creation from Timeline Markers
**Priority:** High  
**Files:** 
- `src/renderer/lib/state/chapters.svelte.ts` (update)
- `src/electron/ipc/handlers/chapters.ts` (update if needed)

**Flow:**
1. User defines chapters in ChapterDefinition component
2. Clicks "Create All"
3. For each draft chapter:
   ```typescript
   // 1. Create chapter in DB
   const chapter = await createChapter({
     projectId,
     title: draft.title,
     startTime: draft.startTime,
     endTime: draft.endTime
   });
   
   // 2. Link VOD asset to chapter
   await linkAssetToChapter(chapter.id, vodAssetId);
   
   // 3. Start transcription (async, don't wait)
   if (settings.autoTranscribeOnImport) {
     transcribeChapter(chapter.id);
   }
   ```

**Validation:**
- Ensure `endTime <= asset.duration`
- Ensure chapters don't overlap (or allow overlap with warning)
- Validate chapter duration > 0

---

### 8. Implement Auto-Chapter Creation from Individual Files
**Priority:** High  
**Files:** 
- `src/renderer/lib/components/ImportChoice.svelte`
- `src/renderer/lib/state/chapters.svelte.ts` (update)

**Flow:**
1. User drops/selects multiple files in ImportChoice
2. For each file:
   ```typescript
   // 1. Create asset (existing logic)
   const asset = await addAsset(projectId, filePath);
   
   // 2. Generate chapter title from filename
   const title = generateChapterTitleFromFilename(asset.file_path);
   // e.g., "intro_clip.mp4" → "intro_clip"
   // e.g., duplicate "intro_clip.mp4" + "intro_clip.mkv" → "intro_clip_1", "intro_clip_2"
   
   // 3. Create chapter spanning full asset
   const chapter = await createChapter({
     projectId,
     title,
     startTime: 0,
     endTime: asset.duration || 0
   });
   
   // 4. Link asset to chapter
   await linkAssetToChapter(chapter.id, asset.id);
   
   // 5. Start transcription
   if (settings.autoTranscribeOnImport) {
     transcribeChapter(chapter.id);
   }
   ```

**Smart Naming Logic:**
```typescript
function generateChapterTitleFromFilename(
  filePath: string, 
  existingTitles: string[]
): string {
  const basename = path.basename(filePath, path.extname(filePath));
  
  if (!existingTitles.includes(basename)) {
    return basename;
  }
  
  // Find next available number
  let counter = 1;
  while (existingTitles.includes(`${basename}_${counter}`)) {
    counter++;
  }
  return `${basename}_${counter}`;
}
```

---

## Integration Points

### Where ImportChoice Appears
Replace the current empty state in `ProjectDetail.svelte`:

```svelte
<!-- Before -->
{:else if projectDetail.assets.length === 0}
  <div class="empty-state">
    <p>📹 Drop video files here to get started</p>
  </div>

<!-- After -->
{:else if projectDetail.assets.length === 0 && chaptersState.chapters.length === 0}
  <ImportChoice 
    projectId={project.id}
    onVODImport={(filePath) => showChapterDefinition(filePath)}
    onFilesImport={(filePaths) => autoCreateChaptersFromFiles(project.id, filePaths)}
  />
```

### ChapterDefinition Flow
When user selects "Import Full VOD":
1. Show file picker
2. Create asset for VOD
3. Navigate to ChapterDefinition with the asset
4. User defines chapters
5. On "Create All", create chapters and link to asset
6. Navigate to main project view with chapters panel

---

## Dependencies Between Tasks

```
Phase 1 (Foundation) ───┐
                        ├──→ Task 5 (ImportChoice)
                        ├──→ Task 6 (ChapterDefinition)
                        ├──→ Task 7 (VOD Chapter Creation)
                        └──→ Task 8 (Files Chapter Creation)
```

All Phase 2 tasks depend on Phase 1 being complete.

---

## Success Criteria

- [ ] ImportChoice displays when project is empty
- [ ] Can import VOD and see ChapterDefinition
- [ ] Timeline scrubber works for marking chapter boundaries
- [ ] Can add multiple draft chapters
- [ ] "Create All" creates real chapters in DB linked to VOD
- [ ] Can import individual files and auto-create chapters
- [ ] Duplicate filenames get numbered (e.g., "file_1", "file_2")
- [ ] Chapters appear in state after creation
- [ ] Transcription starts automatically (if setting enabled)
