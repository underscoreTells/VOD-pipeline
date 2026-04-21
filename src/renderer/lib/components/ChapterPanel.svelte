<script lang="ts">
  import type { Chapter, Asset } from "$shared/types/database";
  import { chaptersState, selectChapter, deleteChapter, updateChapter, getAssetsForChapter } from "../state/chapters.svelte";
  import { collapseLeft } from "../state/layout.svelte";
  import { formatTime } from "../utils/time";
  import { formatChapterRange } from "./chapter-panel-helpers.js";
  import Icon from './ui/Icon.svelte';
  import IconButton from './ui/IconButton.svelte';
  import { Video, Folder, Check, X, Pencil, Trash2, ChevronRight, ChevronDown } from '../constants';

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
    return getAssetsForChapter(chapterId) ?? [];
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
    <div class="header-actions">
      <button class="import-btn" onclick={onImportClick}>
        + Import
      </button>
      <button class="collapse-btn" onclick={collapseLeft}>
        Hide
      </button>
    </div>
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
    <div class="chapters-list scrollbar-thin">
      {#each vodGroups() as group (group.assetId)}
        <div class="asset-group">
          <button
            class="asset-header"
            onclick={() => toggleGroup(group.assetId)}
          >
            <span class="toggle-icon">{#if isExpanded(group.assetId)}<Icon icon={ChevronDown} size={14} />{:else}<Icon icon={ChevronRight} size={14} />{/if}</span>
            <span class="asset-icon"><Icon icon={Video} size={14} /></span>
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
                    <div class="chapter-details">
                      <span class="chapter-title">{chapter.title}</span>
                      <span class="chapter-range">{formatChapterRange(chapter)}</span>
                    </div>
                  {/if}
                  
                  <span class="chapter-time">
                    {formatTime(chapter.end_time - chapter.start_time)}
                  </span>
                  
                  <div class="chapter-actions">
                    {#if editingChapterId === chapter.id}
                      <IconButton icon={Check} size={14} onclick={(e) => { e.stopPropagation(); saveEdit(chapter.id); }} title="Save" />
                      <IconButton icon={X} size={14} onclick={(e) => { e.stopPropagation(); cancelEdit(); }} title="Cancel" />
                    {:else}
                      <IconButton icon={Pencil} size={14} onclick={(e) => { e.stopPropagation(); startEditing(chapter); }} title="Edit" />
                      <IconButton icon={Trash2} size={14} variant="destructive" onclick={(e) => { e.stopPropagation(); handleDeleteChapter(chapter.id); }} title="Delete" />
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if individualGroups().length > 0}
        <div class="asset-group individual-files">
          <button
            class="asset-header"
            onclick={() => toggleGroup(-1)}
          >
            <span class="toggle-icon">{#if isExpanded(-1)}<Icon icon={ChevronDown} size={14} />{:else}<Icon icon={ChevronRight} size={14} />{/if}</span>
            <span class="asset-icon"><Icon icon={Folder} size={14} /></span>
            <span class="asset-name">Individual Files</span>
            <span class="chapter-count">({individualGroups().reduce((acc, g) => acc + g.chapters.length, 0)})</span>
          </button>
          
          {#if isExpanded(-1)}
            <div class="chapter-list">
              {#each individualGroups() as group (group.assetId)}
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
                      <div class="chapter-details">
                        <span class="chapter-title">{chapter.title}</span>
                        <span class="chapter-range">{formatChapterRange(chapter)}</span>
                      </div>
                    {/if}
                    
                    <span class="chapter-time">
                      {formatTime(chapter.end_time - chapter.start_time)}
                    </span>
                    
                    <div class="chapter-actions">
                      {#if editingChapterId === chapter.id}
                        <IconButton icon={Check} size={14} onclick={(e) => { e.stopPropagation(); saveEdit(chapter.id); }} title="Save" />
                        <IconButton icon={X} size={14} onclick={(e) => { e.stopPropagation(); cancelEdit(); }} title="Cancel" />
                      {:else}
                        <IconButton icon={Pencil} size={14} onclick={(e) => { e.stopPropagation(); startEditing(chapter); }} title="Edit" />
                        <IconButton icon={Trash2} size={14} variant="destructive" onclick={(e) => { e.stopPropagation(); handleDeleteChapter(chapter.id); }} title="Delete" />
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
    background: var(--surface-raised);
    border-right: 1px solid var(--border-default);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4);
    border-bottom: 1px solid var(--border-default);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .panel-header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-base);
  }

  .import-btn {
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    padding: var(--space-1_5) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-xs);
    font-weight: 500;
  }

  .import-btn:hover {
    background: var(--accent-primary-hover);
  }

  .collapse-btn {
    background: var(--surface-active);
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    padding: var(--space-1_5) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-xs);
  }

  .collapse-btn:hover {
    background: var(--border-strong);
    color: var(--text-primary);
  }

  .loading {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-tertiary);
  }

  .empty-state {
    padding: var(--space-8);
    text-align: center;
  }

  .empty-state p {
    color: var(--text-disabled);
    margin: 0 0 var(--space-4) 0;
  }

  .action-btn {
    background: var(--surface-active);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .action-btn:hover {
    background: var(--border-strong);
  }

  .chapters-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2);
  }

  .asset-group {
    margin-bottom: var(--space-2);
  }

  .asset-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3);
    background: var(--surface-elevated);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    transition: background var(--transition-fast) ease;
  }

  .asset-header:hover {
    background: var(--surface-hover);
  }

  .toggle-icon {
    color: var(--text-disabled);
    width: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .asset-icon {
    display: inline-flex;
    align-items: center;
  }

  .asset-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chapter-count {
    color: var(--text-disabled);
    font-size: var(--font-size-xs);
  }

  .chapter-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1) 0 var(--space-1) var(--space-6);
  }

  .chapter-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast) ease;
  }

  .chapter-item:hover {
    background: var(--surface-hover);
  }

  .chapter-item.selected {
    background: var(--accent-primary);
  }

  .chapter-item.selected .chapter-title,
  .chapter-item.selected .chapter-range,
  .chapter-item.selected .chapter-time {
    color: var(--text-primary);
  }

  .chapter-details {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .chapter-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }

  .chapter-range {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-disabled);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
  }

  .chapter-time {
    color: var(--text-disabled);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
  }

  .chapter-actions {
    display: flex;
    gap: var(--space-1);
    opacity: 0;
    transition: opacity var(--transition-fast) ease;
  }

  .chapter-item:hover .chapter-actions,
  .chapter-item.selected .chapter-actions {
    opacity: 1;
  }

  .edit-input {
    flex: 1;
    background: var(--surface-raised);
    border: 1px solid var(--accent-primary);
    color: var(--text-primary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
  }

  .individual-files .asset-header {
    background: var(--surface-hover);
  }
</style>
