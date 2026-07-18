<script lang="ts">
  import type { Chapter, Asset } from "$shared/types/database";
  import { chaptersState, selectChapter, deleteChapter, updateChapter, getAssetsForChapter } from "../state/chapters.svelte";
  import { collapseLeft } from "../state/layout.svelte";
  import { formatTime } from "../utils/time";
  import { formatChapterRange } from "./chapter-panel-helpers.js";
  import Icon from './ui/Icon.svelte';
  import IconButton from './ui/IconButton.svelte';
  import { Video, Folder, Check, X, Pencil, Trash2, ChevronRight, ChevronDown } from '../constants';
  import { cn } from "../utils/cn";

  interface Props {
    class?: string;
    projectAssets: Asset[];
    onImportClick: () => void;
    onChapterSelect?: (chapterId: number) => void | Promise<void>;
  }

  let {
    class: className = '',
    projectAssets,
    onImportClick,
    onChapterSelect,
  }: Props = $props();

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
    if (onChapterSelect) {
      void onChapterSelect(chapterId);
      return;
    }
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

<div
  class={cn(
    'chapter-panel flex h-full flex-col border-r border-border-default bg-surface-raised',
    className,
  )}
>
  <div class="flex items-center justify-between border-b border-border-default bg-surface-base px-[14px] py-3">
    <h3 class="m-0 text-app-base font-semibold text-text-primary">Chapters</h3>
    <div class="flex items-center gap-2">
      <button
        class="rounded-[4px] border border-border-default bg-transparent px-2.5 py-1 text-app-xs font-medium text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
        onclick={onImportClick}
      >
        + Import
      </button>
      <button
        class="rounded-[4px] border border-transparent bg-transparent px-2.5 py-1 text-app-xs text-text-secondary transition-all hover:bg-surface-hover hover:text-text-primary"
        onclick={collapseLeft}
      >
        Hide
      </button>
    </div>
  </div>

  {#if chaptersState.isLoading}
    <div class="p-8 text-center text-app-sm text-text-tertiary">Loading chapters...</div>
  {:else if chaptersState.chapters.length === 0}
    <div class="p-8 text-center">
      <p class="mb-4 text-app-sm text-text-tertiary">No chapters yet</p>
      <button
        class="rounded-[4px] border border-border-default bg-transparent px-4 py-2 text-app-sm font-medium text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
        onclick={onImportClick}
      >
        Import videos
      </button>
    </div>
  {:else}
    <div class="chapters-list scrollbar-thin flex-1 overflow-y-auto p-2">
      {#each vodGroups() as group (group.assetId)}
        <div class="mb-1">
          <button
            class="flex w-full items-center gap-2 rounded-[4px] bg-transparent px-2.5 py-2 text-left text-app-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            onclick={() => toggleGroup(group.assetId)}
          >
            <span class="inline-flex w-[14px] items-center justify-center text-text-disabled">{#if isExpanded(group.assetId)}<Icon icon={ChevronDown} size={14} />{:else}<Icon icon={ChevronRight} size={14} />{/if}</span>
            <span class="inline-flex items-center"><Icon icon={Video} size={14} /></span>
            <span class="flex-1 truncate">{getAssetDisplayName(group.asset)}</span>
            <span class="text-app-xs text-text-disabled">({group.chapters.length})</span>
          </button>
          
          {#if isExpanded(group.assetId)}
            <div class="ml-[18px] flex flex-col border-l border-border-subtle py-1">
              {#each group.chapters as chapter (chapter.id)}
                {@const selected = isSelected(chapter.id)}
                <div
                  class="group/chapter relative ml-[-1px] flex cursor-pointer items-center gap-2 rounded-r-[4px] border-l-[3px] border-l-transparent px-2.5 py-1.5 transition-colors hover:bg-surface-hover"
                  class:bg-surface-hover={selected}
                  class:border-l-accent-primary={selected}
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
                      class="flex-1 rounded-[4px] border border-accent-primary bg-surface-base px-2 py-1 text-app-sm text-text-primary"
                      onclick={(e) => e.stopPropagation()}
                    />
                  {:else}
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-app-sm leading-[1.3] text-text-secondary" class:text-text-primary={selected} class:font-medium={selected}>{chapter.title}</span>
                      <span class="truncate font-mono text-app-xs text-text-tertiary" class:text-text-secondary={selected}>{formatChapterRange(chapter)}</span>
                    </div>
                  {/if}
                  {#if chapter.rough_cut_completed_at}
                    <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-primary-subtle text-accent-primary" title="Rough cut complete"><Icon icon={Check} size={11} /></span>
                  {/if}
                  
                  <span class="shrink-0 font-mono text-app-xs text-text-tertiary" class:text-text-secondary={selected}>
                    {formatTime(chapter.end_time - chapter.start_time)}
                  </span>
                  
                  <div
                    class="flex gap-1 opacity-0 transition-opacity group-hover/chapter:opacity-100"
                    class:opacity-100={selected}
                  >
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
        <div class="mb-1">
          <button
            class="flex w-full items-center gap-2 rounded-[4px] bg-transparent px-2.5 py-2 text-left text-app-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            onclick={() => toggleGroup(-1)}
          >
            <span class="inline-flex w-[14px] items-center justify-center text-text-disabled">{#if isExpanded(-1)}<Icon icon={ChevronDown} size={14} />{:else}<Icon icon={ChevronRight} size={14} />{/if}</span>
            <span class="inline-flex items-center"><Icon icon={Folder} size={14} /></span>
            <span class="flex-1 truncate">Individual Files</span>
            <span class="text-app-xs text-text-disabled">({individualGroups().reduce((acc, g) => acc + g.chapters.length, 0)})</span>
          </button>
          
          {#if isExpanded(-1)}
            <div class="ml-[18px] flex flex-col border-l border-border-subtle py-1">
              {#each individualGroups() as group (group.assetId)}
                {#each group.chapters as chapter (chapter.id)}
                  {@const selected = isSelected(chapter.id)}
                  <div
                    class="group/chapter relative ml-[-1px] flex cursor-pointer items-center gap-2 rounded-r-[4px] border-l-[3px] border-l-transparent px-2.5 py-1.5 transition-colors hover:bg-surface-hover"
                    class:bg-surface-hover={selected}
                    class:border-l-accent-primary={selected}
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
                        class="flex-1 rounded-[4px] border border-accent-primary bg-surface-base px-2 py-1 text-app-sm text-text-primary"
                        onclick={(e) => e.stopPropagation()}
                      />
                    {:else}
                      <div class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-app-sm leading-[1.3] text-text-secondary" class:text-text-primary={selected} class:font-medium={selected}>{chapter.title}</span>
                        <span class="truncate font-mono text-app-xs text-text-tertiary" class:text-text-secondary={selected}>{formatChapterRange(chapter)}</span>
                      </div>
                    {/if}
                    {#if chapter.rough_cut_completed_at}
                      <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-primary-subtle text-accent-primary" title="Rough cut complete"><Icon icon={Check} size={11} /></span>
                    {/if}
                    
                    <span class="shrink-0 font-mono text-app-xs text-text-tertiary" class:text-text-secondary={selected}>
                      {formatTime(chapter.end_time - chapter.start_time)}
                    </span>
                    
                    <div
                      class="flex gap-1 opacity-0 transition-opacity group-hover/chapter:opacity-100"
                      class:opacity-100={selected}
                    >
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
