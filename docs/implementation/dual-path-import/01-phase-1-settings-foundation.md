# Phase 1: Settings & Foundation

## Tasks

### 1. Add Setting: autoChapterNamingEnabled
**Priority:** Medium  
**Files:** `src/renderer/lib/state/settings.svelte.ts`

Add a new boolean setting to control whether auto-chapter naming is enabled.

```typescript
interface Settings {
  // ... existing settings
  autoChapterNamingEnabled: boolean;  // default: true
}
```

**Implementation Notes:**
- Add to default settings object
- Add to settings validation
- Add to import/export functions
- Add UI control in SettingsPanel component

---

### 2. Add Setting: autoChapterNamingModel
**Priority:** Medium  
**Files:** `src/renderer/lib/state/settings.svelte.ts`

Add a setting to specify which LLM model to use for auto-naming.

```typescript
interface Settings {
  // ... existing settings
  autoChapterNamingModel: string;  // default: 'gpt-4o-mini'
}
```

**Implementation Notes:**
- Use cheap models: gpt-4o-mini, gemini-1.5-flash
- Add dropdown in SettingsPanel with model options
- Validate model is supported

---

### 3. Expose Chapter IPC Operations in Preload API
**Priority:** High  
**Files:** 
- `src/electron/preload.ts`
- `src/electron/preload.d.ts`
- `src/renderer/lib/state/electron.svelte.ts` (add types)

**Current State:** IPC handlers exist in `handlers.ts` but are NOT exposed to renderer via preload.

**Required IPC Channels to Expose:**
- `CHAPTER_CREATE` - Create a new chapter
- `CHAPTER_GET_BY_PROJECT` - Get all chapters for a project
- `CHAPTER_UPDATE` - Update chapter metadata
- `CHAPTER_DELETE` - Delete a chapter
- `CHAPTER_ADD_ASSET` - Link an asset to a chapter
- `CHAPTER_GET_ASSETS` - Get assets linked to a chapter

**Example Implementation:**
```typescript
// In preload.ts ElectronAPI interface
chapters: {
  create: (input: CreateChapterInput) => Promise<CreateChapterResult>;
  getByProject: (projectId: number) => Promise<GetChaptersResult>;
  update: (id: number, updates: UpdateChapterInput) => Promise<UpdateChapterResult>;
  delete: (id: number) => Promise<DeleteChapterResult>;
  addAsset: (chapterId: number, assetId: number) => Promise<AddAssetToChapterResult>;
  getAssets: (chapterId: number) => Promise<GetChapterAssetsResult>;
}
```

---

### 4. Create Chapter State Management
**Priority:** High  
**File:** `src/renderer/lib/state/chapters.svelte.ts` (new file)

Create a new Svelte 5 state file for managing chapters.

**Required State:**
```typescript
interface ChaptersState {
  chapters: Chapter[];
  selectedChapterId: number | null;
  isLoading: boolean;
  error: string | null;
  isImporting: boolean;  // For showing import choice
  importChoice: 'vod' | 'files' | null;
}
```

**Required Functions:**
```typescript
// Load chapters for a project
export async function loadChapters(projectId: number): Promise<void>

// Create a new chapter (VOD path)
export async function createChapter(
  projectId: number, 
  title: string, 
  startTime: number, 
  endTime: number
): Promise<Chapter | null>

// Select a chapter (updates main view)
export function selectChapter(chapterId: number | null): void

// Update chapter metadata
export async function updateChapter(
  chapterId: number, 
  updates: Partial<Chapter>
): Promise<boolean>

// Delete a chapter
export async function deleteChapter(chapterId: number): Promise<boolean>

// Link an asset to a chapter
export async function linkAssetToChapter(
  chapterId: number, 
  assetId: number
): Promise<boolean>

// Auto-create chapters from files (Files path)
export async function autoCreateChaptersFromFiles(
  projectId: number, 
  assets: Asset[]
): Promise<Chapter[]>

// Reorder chapters via drag-and-drop
export async function reorderChapters(
  chapterIds: number[]
): Promise<boolean>
```

**Integration Notes:**
- Import functions from `electron.svelte.ts`
- Use existing error handling patterns
- Follow Svelte 5 runes API ($state, $derived)

---

## Dependencies Between Tasks

```
Task 1 (Settings) ─────────────────────┐
                                       │
Task 2 (Settings) ─────────────────────┤
                                       ├──→ Task 4 (State Management)
Task 3 (IPC Exposure) ─────────────────┘
```

Task 4 depends on Tasks 1-3 because state management needs the IPC functions and settings.

---

## Success Criteria

- [ ] `autoChapterNamingEnabled` setting persists and works
- [ ] `autoChapterNamingModel` setting persists and works
- [ ] All chapter IPC operations available in renderer via `window.electronAPI.chapters`
- [ ] `chaptersState` created with all required properties and functions
- [ ] Can call `loadChapters()`, `createChapter()`, `selectChapter()` without errors
- [ ] State updates trigger UI reactivity correctly
