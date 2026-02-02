<script lang="ts">
  import type { Chapter, Asset } from "$shared/types/database";
  import { chaptersState, selectChapter, deleteChapter, updateChapter, getAssetsForChapter } from "../state/chapters.svelte";
  import { formatTime } from "../utils/time";

  interface Props {
    projectAssets: Asset[];
    onImportClick: () => void;
  }

  let { projectAssets, onImportClick }: Props = $props();

  // Track which groups are expanded
  let expandedGroups = $state<Set<number>>(new Set());
  
  // Track editing state
  let editingChapterId = $state<number | null>(null);
  let editTitle = $state("");

  // Group chapters by their source asset
  const chapterGroups = $derived(() => {
    const groups = new Map<number, { asset: Asset | null; chapters: Chapter[] }>();
    
    // First, organize chapters by their primary asset
    for (const chapter of chaptersState.chapters) {
      // Get the primary asset ID for this chapter
      const assetIds = getChapterAssetIds(chapter.id);
      const primaryAssetId = assetIds[0];
      
      if (!groups.has(primaryAssetId)) {
        const asset = projectAssets.find((a) => a.id === primaryAssetId) || null;
        groups.set(primaryAssetId, { asset, chapters: [] });
      }
      
      groups.get(primaryAssetId)!.chapters.push(chapter);
    }
    
    // Sort chapters within each group by display_order, then by start_time
    for (const [, group] of groups) {
      group.chapters.sort((a, b) => {
        if (a.display_order !== b.display_order) {
          return a.display_order - b.display_order;
        }
        return a.start_time - b.start_time;
      });
    }
    
    return Array.from(groups.entries()).map(([assetId, group]) => ({
      assetId,
      asset: group.asset,
      chapters: group.chapters,
      isVod: group.chapters.length > 1 || (group.asset?.duration || 0) > 300, // VOD if >1 chapter or >5min
    }));
  });

  // Separate VODs and individual files
  const vodGroups = $derived(() => chapterGroups().filter((g) => g.isVod));
  const individualGroups = $derived(() => chapterGroups().filter((g) => !g.isVod));

  function getChapterAssetIds(chapterId: number): number[] {
    // This would ideally be fetched from the backend
    // For now, we'll infer from the project assets
    return [];
  }

  function toggleGroup(assetId: number) {
    if (expandedGroups.has(assetId)) {
      expandedGroups.delete(assetId);
    } else {
      expandedGroups.add(assetId);
    }
    expandedGroups = new Set(expandedGroups);
  }

  function isExpanded(assetId: number): boolean {
    return expandedGroups.has(assetId);
  }

  function handleSelectChapter(chapterId: number) {
    selectChapter(chapterId);
  }

  function handleDeleteChapter(chapterId: number) {
    if (confirm("Are you sure you want to delete this chapter?")) {
      deleteChapter(chapterId);
    }
  }

  function startEditing(chapter: Chapter) {
    editingChapterId = chapter.id;
    editTitle = chapter.title;
  }

  function saveEdit(chapterId: number) {
    updateChapter(chapterId, { title: editTitle });
    editingChapterId = null;
    editTitle = "";
  }

  function cancelEdit() {
    editingChapterId = null;
    editTitle = "";
  }

  function getAssetDisplayName(asset: Asset | null): string {
    if (!asset) return "Unknown Source";
    const parts = asset.file_path.split(/[/\\]/);
    return parts[parts.length - 1] || "Unknown";
  }

  function isSelected(chapterId: number): boolean {
    return chaptersState.selectedChapterId === chapterId;
  }
</script>

<div class="chapter-panel">
  <div class="panel-header">
    <h3>Chapters</h3>
    <button class="import-btn" onclick={onImportClick}>
      + Import
    </button>
  </div>

  {#if chaptersState.isLoading}
    <div class="loading">Loading chapters...</div>
  {:else if chaptersState.chapters.length === 0}
    <div class="empty-state">
      <p>No chapters yet</p>
      <button class="action-btn" onclick={onImportClick}>
        Import videos
      </button>
    </div>
  {:else}
    <div class="chapters-list">
      <!-- VOD Groups -->
      {#each vodGroups() as group}
        <div class="asset-group">
          <button
            class="asset-header"
            onclick={() => toggleGroup(group.assetId)}
          >
            <span class="toggle-icon">{isExpanded(group.assetId) ? "▼" : "▶"}</span>
            <span class="asset-icon">📹</span>
            <span class="asset-name">{getAssetDisplayName(group.asset)}</span>
            <span class="chapter-count">({group.chapters.length})</span>
          </button>
          
          {#if isExpanded(group.assetId)}
            <div class="chapter-list">
              {#each group.chapters as chapter (chapter.id)}
                <div
                  class="chapter-item"
                  class:selected={isSelected(chapter.id)}
                  onclick={() => handleSelectChapter(chapter.id)}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectChapter(chapter.id);
                    }
                  }}
                  role="button"
                  tabindex="0"
                >
                  {#if editingChapterId === chapter.id}
                    <input
                      type="text"
                      bind:value={editTitle}
                      onkeydown={(e) => {
                        if (e.key === "Enter") saveEdit(chapter.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      class="edit-input"
                      onclick={(e) => e.stopPropagation()}
                    />
                  {:else}
                    <span class="chapter-title">{chapter.title}</span>
                  {/if}
                  
                  <span class="chapter-time">
                    {formatTime(chapter.end_time - chapter.start_time)}
                  </span>
                  
                  <div class="chapter-actions">
                    {#if editingChapterId === chapter.id}
                      <button
                        class="action-icon"
                        onclick={(e) => {
                          e.stopPropagation();
                          saveEdit(chapter.id);
                        }}
                      >
                        ✓
                      </button>
                      <button
                        class="action-icon"
                        onclick={(e) => {
                          e.stopPropagation();
                          cancelEdit();
                        }}
                      >
                        ✕
                      </button>
                    {:else}
                      <button
                        class="action-icon"
                        onclick={(e) => {
                          e.stopPropagation();
                          startEditing(chapter);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        class="action-icon delete"
                        onclick={(e) => {
                          e.stopPropagation();
                          handleDeleteChapter(chapter.id);
                        }}
                      >
                        🗑
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      <!-- Individual Files Section -->
      {#if individualGroups().length > 0}
        <div class="asset-group individual-files">
          <button
            class="asset-header"
            onclick={() => toggleGroup(-1)}
          >
            <span class="toggle-icon">{isExpanded(-1) ? "▼" : "▶"}</span>
            <span class="asset-icon">📁</span>
            <span class="asset-name">Individual Files</span>
            <span class="chapter-count">({individualGroups().reduce((acc, g) => acc + g.chapters.length, 0)})</span>
          </button>
          
          {#if isExpanded(-1)}
            <div class="chapter-list">
              {#each individualGroups() as group}
                {#each group.chapters as chapter (chapter.id)}
                  <div
                    class="chapter-item"
                    class:selected={isSelected(chapter.id)}
                    onclick={() => handleSelectChapter(chapter.id)}
                    onkeydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectChapter(chapter.id);
                      }
                    }}
                    role="button"
                    tabindex="0"
                  >
                    {#if editingChapterId === chapter.id}
                      <input
                        type="text"
                        bind:value={editTitle}
                        onkeydown={(e) => {
                          if (e.key === "Enter") saveEdit(chapter.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        class="edit-input"
                        onclick={(e) => e.stopPropagation()}
                      />
                    {:else}
                      <span class="chapter-title">{chapter.title}</span>
                    {/if}
                    
                    <span class="chapter-time">
                      {formatTime(chapter.end_time - chapter.start_time)}
                    </span>
                    
                    <div class="chapter-actions">
                      {#if editingChapterId === chapter.id}
                        <button
                          class="action-icon"
                          onclick={(e) => {
                            e.stopPropagation();
                            saveEdit(chapter.id);
                          }}
                        >
                          ✓
                        </button>
                        <button
                          class="action-icon"
                          onclick={(e) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                        >
                          ✕
                        </button>
                      {:else}
                        <button
                          class="action-icon"
                          onclick={(e) => {
                            e.stopPropagation();
                            startEditing(chapter);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          class="action-icon delete"
                          onclick={(e) => {
                            e.stopPropagation();
                            handleDeleteChapter(chapter.id);
                          }}
                        >
                          🗑
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chapter-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
    border-right: 1px solid #333;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid #333;
  }

  .panel-header h3 {
    margin: 0;
    color: #fff;
    font-size: 1rem;
  }

  .import-btn {
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .import-btn:hover {
    background: #1d4ed8;
  }

  .loading {
    padding: 2rem;
    text-align: center;
    color: #888;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }

  .empty-state p {
    color: #666;
    margin: 0 0 1rem 0;
  }

  .action-btn {
    background: #333;
    color: #fff;
    border: 1px solid #444;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .action-btn:hover {
    background: #444;
  }

  .chapters-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .asset-group {
    margin-bottom: 0.5rem;
  }

  .asset-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem;
    background: #252525;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    color: #ccc;
    font-size: 0.875rem;
    transition: background 0.2s;
  }

  .asset-header:hover {
    background: #2a2a2a;
  }

  .toggle-icon {
    font-size: 0.625rem;
    color: #666;
    width: 12px;
  }

  .asset-icon {
    font-size: 1rem;
  }

  .asset-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chapter-count {
    color: #666;
    font-size: 0.75rem;
  }

  .chapter-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.25rem 0 0.25rem 1.5rem;
  }

  .chapter-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .chapter-item:hover {
    background: #2a2a2a;
  }

  .chapter-item.selected {
    background: #2563eb;
  }

  .chapter-item.selected .chapter-title,
  .chapter-item.selected .chapter-time {
    color: #fff;
  }

  .chapter-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #ccc;
    font-size: 0.875rem;
  }

  .chapter-time {
    color: #666;
    font-size: 0.75rem;
    font-family: monospace;
  }

  .chapter-actions {
    display: flex;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .chapter-item:hover .chapter-actions,
  .chapter-item.selected .chapter-actions {
    opacity: 1;
  }

  .action-icon {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0.125rem 0.25rem;
    font-size: 0.75rem;
    border-radius: 3px;
  }

  .action-icon:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .action-icon.delete:hover {
    background: rgba(248, 113, 113, 0.2);
    color: #f87171;
  }

  .edit-input {
    flex: 1;
    background: #1e1e1e;
    border: 1px solid #2563eb;
    color: #fff;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.875rem;
  }

  .individual-files .asset-header {
    background: #2a2a2a;
  }
</style>
