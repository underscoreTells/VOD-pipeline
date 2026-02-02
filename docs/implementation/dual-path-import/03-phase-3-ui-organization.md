# Phase 3: UI Organization

## Tasks

### 9. Implement Drag-and-Drop Chapter Reordering
**Priority:** High  
**Files:** 
- `src/renderer/lib/components/ChapterPanel.svelte`
- `src/renderer/lib/state/chapters.svelte.ts` (add reorder function)
- Database schema (add `display_order` or use existing)

**Current State:** The database has `display_order` field in beats table, but chapters table doesn't have an explicit ordering field. Chapters currently order by `created_at` or `id`.

**Options:**
1. Add `display_order` column to chapters table
2. Use the `id` order (simpler, but less flexible)
3. Store order in project metadata

**Recommended:** Add `display_order` to chapters table for explicit ordering.

**Database Migration:**
```sql
-- Add to database/schema.sql
ALTER TABLE chapters ADD COLUMN display_order INTEGER DEFAULT 0;
CREATE INDEX idx_chapters_display_order ON chapters(display_order);
```

**Implementation:**
```typescript
// In chapters.svelte.ts
export async function reorderChapters(orderedIds: number[]): Promise<boolean> {
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await updateChapter(orderedIds[i], { display_order: i });
    }
    // Reload to get new order
    await loadChapters(currentProjectId);
    return true;
  } catch (error) {
    console.error('Failed to reorder chapters:', error);
    return false;
  }
}
```

**UI Implementation (Svelte):**
```svelte
<script>
  import { dndzone } from 'svelte-dnd-action';
  
  let items = $derived(chaptersState.chapters.map(c => ({
    id: c.id,
    chapter: c
  })));
  
  function handleDndConsider(e) {
    items = e.detail.items;
  }
  
  function handleDndFinalize(e) {
    items = e.detail.items;
    // Save new order
    const newOrder = items.map(i => i.id);
    reorderChapters(newOrder);
  }
</script>

<div use:dndzone={{items, flipDurationMs: 300}} 
     on:consider={handleDndConsider} 
     on:finalize={handleDndFinalize}>
  {#each items as item (item.id)}
    <ChapterListItem chapter={item.chapter} />
  {/each}
</div>
```

**Note:** May need to add `svelte-dnd-action` package or use native HTML5 drag-and-drop.

---

### 10. Redesign ProjectDetail for Chapters-First Organization
**Priority:** High  
**File:** `src/renderer/lib/components/ProjectDetail.svelte`

**Current Layout:**
- Header with import/export buttons
- Timeline in center
- BeatPanel on right
- Asset-based organization

**New Layout:**
```
┌────────────────────────────────────────────────────────────┐
│ Header: Project Name + Import/Export Buttons              │
├────────────────────────────┬───────────────────────────────┤
│ 📹 Chapters Panel          │    Main Content Area          │
│ (sidebar)                  │    (contextual)               │
│                            │                               │
│ Stream 1: vod_001.mp4      │  When no chapter selected:    │
│ ├── Chapter 1              │  ┌─────────────────────────┐  │
│ ├── Chapter 2 ⬅️ selected  │  │   Select a chapter      │  │
│ └── Chapter 3              │  │   to view its timeline  │  │
│                            │  └─────────────────────────┘  │
│ Stream 2: vod_002.mp4      │                               │
│ ├── Chapter 4              │  When chapter selected:       │
│ └── Chapter 5              │  ┌─────────────────────────┐  │
│                            │  │   Chapter Timeline      │  │
│ 📁 Individual Files        │  │   with beats/clips      │  │
│ ├── intro_clip             │  └─────────────────────────┘  │
│ └── outro_clip             │                               │
│                            │                               │
│ [+ Import More]            │                               │
└────────────────────────────┴───────────────────────────────┘
```

**Changes Needed:**

1. **Replace empty state with ImportChoice:**
```svelte
{#if chaptersState.chapters.length === 0 && projectDetail.assets.length === 0}
  <ImportChoice ... />
{:else}
  <!-- New layout -->
  <div class="project-layout">
    <ChapterPanel />
    <MainContent />
  </div>
{/if}
```

2. **Restructure main container:**
```svelte
<div class="project-layout">
  <aside class="chapters-sidebar">
    <ChapterPanel />
  </aside>
  
  <main class="main-content">
    {#if chaptersState.selectedChapterId}
      <ChapterTimeline chapterId={chaptersState.selectedChapterId} />
    {:else}
      <EmptySelectionState />
    {/if}
  </main>
</div>
```

3. **Remove or repurpose existing asset import buttons:**
   - Current "Import Video" button becomes "Import VOD/Files"
   - Opens ImportChoice dialog even when project has content

---

### 11. Create ChapterPanel Sidebar Component
**Priority:** High  
**File:** `src/renderer/lib/components/ChapterPanel.svelte` (new file)

Sidebar component listing all chapters organized by source.

**Features:**
- Group chapters by source asset (for VODs)
- Show standalone chapters (for individual files)
- Click to select chapter
- Drag-and-drop reordering
- Show chapter metadata (duration, transcript status)
- Edit chapter title inline
- Delete chapter with confirmation
- Visual indicator for selected chapter

**UI Structure:**
```svelte
<div class="chapter-panel">
  <div class="panel-header">
    <h3>Chapters</h3>
    <button on:click={() => showImportDialog = true}>+ Import</button>
  </div>
  
  <div class="chapters-list" use:dndzone={{...}}>
    <!-- Group by source asset -->
    {#each vodGroups as group}
      <div class="asset-group">
        <div class="asset-header">
          <span class="asset-icon">📹</span>
          <span class="asset-name">{group.assetName}</span>
        </div>
        
        <div class="chapter-list">
          {#each group.chapters as chapter}
            <ChapterListItem 
              {chapter}
              isSelected={chapter.id === selectedChapterId}
              on:select={() => selectChapter(chapter.id)}
              on:edit={() => startEditing(chapter)}
              on:delete={() => confirmDelete(chapter)}
            />
          {/each}
        </div>
      </div>
    {/each}
    
    <!-- Individual files section -->
    {#if individualChapters.length > 0}
      <div class="asset-group">
        <div class="asset-header">
          <span class="asset-icon">📁</span>
          <span class="asset-name">Individual Files</span>
        </div>
        <!-- chapters... -->
      </div>
    {/if}
  </div>
</div>
```

**Data Structure:**
```typescript
// Group chapters by their source asset
interface ChapterGroup {
  assetId: number;
  assetName: string;
  assetType: 'vod' | 'file';
  chapters: Chapter[];
}

const chapterGroups = $derived(() => {
  const groups = new Map<number, ChapterGroup>();
  
  for (const chapter of chaptersState.chapters) {
    const assetIds = getAssetsForChapter(chapter.id);
    const primaryAssetId = assetIds[0]; // First asset is the source
    
    if (!groups.has(primaryAssetId)) {
      const asset = projectDetail.assets.find(a => a.id === primaryAssetId);
      groups.set(primaryAssetId, {
        assetId: primaryAssetId,
        assetName: asset?.file_path.split('/').pop() || 'Unknown',
        assetType: chaptersState.chapters.filter(c => 
          getAssetsForChapter(c.id)[0] === primaryAssetId
        ).length > 1 ? 'vod' : 'file',
        chapters: []
      });
    }
    
    groups.get(primaryAssetId)!.chapters.push(chapter);
  }
  
  return Array.from(groups.values());
});
```

---

## Technical Considerations

### Chapter-Audio Extraction for Display
When user selects a chapter, we need to show its waveform in the timeline. Options:

1. **Extract audio on demand:**
   ```typescript
   // When chapter selected
   const audioPath = await extractAudioSegment(assetId, startTime, endTime);
   // Generate waveform for this segment
   ```

2. **Generate waveform for full asset, display slice:**
   - Generate waveform for full VOD once
   - Display only the relevant time range
   - More efficient for multiple chapters from same VOD

**Recommended:** Option 2 - generate once, display slices.

### State Synchronization
When chapters are reordered:
1. Update local state immediately (for responsive UI)
2. Send reorder command to backend
3. Reload chapters from backend to confirm
4. Handle conflicts if multiple users (future consideration)

---

## Dependencies Between Tasks

```
Task 9 (Drag-and-Drop) ───┐
                          ├──→ Task 11 (ChapterPanel)
Task 10 (ProjectDetail) ──┘
```

Task 11 (ChapterPanel) depends on both Task 9 (for drag-and-drop) and Task 10 (for integration into layout).

---

## Success Criteria

- [ ] ProjectDetail shows new chapters-first layout
- [ ] ChapterPanel appears as sidebar
- [ ] Chapters are grouped by source VOD/file
- [ ] Clicking a chapter selects it and shows timeline
- [ ] Selected chapter has visual highlight
- [ ] Can drag-and-drop to reorder chapters
- [ ] Reorder persists after reload
- [ ] Can edit chapter title inline
- [ ] Can delete chapter with confirmation
- [ ] Shows transcript status (pending/complete) for each chapter
- [ ] Import button in sidebar opens import options
