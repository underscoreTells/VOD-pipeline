<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { timelineState, selectClip, setPlayhead } from '../state/timeline.svelte';
  import { executeDeleteClip } from '../state/project-detail.svelte';
  import { collapseBeat } from '../state/layout.svelte';
  import type { Clip } from '../../../shared/types/database';
  import Icon from './ui/Icon.svelte';
  import { ROLE_CONFIG, ROLE_KEYS, Star, ChevronRight, ChevronDown } from '../constants';
  import type { ClipRole, RoleConfig } from '../constants';
  import { cn } from '../utils/cn';
  import { compareClipsBySourceTime } from '../../../shared/utils/clip-timing.js';
  
  interface Props {
    class?: string;
    clips?: Clip[];
    chapterStartTime?: number;
    chapterDuration?: number | null;
  }
  
  let {
    class: className = '',
    clips = timelineState.clips,
    chapterStartTime = 0,
    chapterDuration = null,
  }: Props = $props();

  const sortedClips = $derived.by(() => {
    return [...clips].sort(compareClipsBySourceTime);
  });

  const clipSections = $derived.by(() => {
    const sections: Array<{
      key: string;
      role: string;
      config: RoleConfig;
      clips: Clip[];
    }> = [];

    for (const clip of sortedClips) {
      const role = (clip.role || 'unassigned') as ClipRole;
      const config = ROLE_CONFIG[role] || ROLE_CONFIG.unassigned;
      const lastSection = sections[sections.length - 1];

      if (!lastSection || lastSection.role !== role) {
        sections.push({
          key: `${role}-${sections.length}-${clip.id}`,
          role,
          config,
          clips: [clip],
        });
        continue;
      }

      lastSection.clips.push(clip);
    }

    return sections;
  });
  
  // Handle clip click
  function handleClipClick(clip: Clip) {
    selectClip(clip.id, false);
    setPlayhead(clip.in_point);
  }

  let contextMenu = $state({
    open: false,
    x: 0,
    y: 0,
    clip: null as Clip | null,
  });
  const collapsedSectionKeys = new SvelteSet<string>();

  const hasAnyCollapsedSections = $derived.by(() => clipSections.some((section) => collapsedSectionKeys.has(section.key)));

  function isSectionCollapsed(sectionKey: string): boolean {
    return collapsedSectionKeys.has(sectionKey);
  }

  function toggleSection(sectionKey: string) {
    if (collapsedSectionKeys.has(sectionKey)) {
      collapsedSectionKeys.delete(sectionKey);
    } else {
      collapsedSectionKeys.add(sectionKey);
    }
  }

  function collapseAllSections() {
    collapsedSectionKeys.clear();
    for (const section of clipSections) {
      collapsedSectionKeys.add(section.key);
    }
  }

  function expandAllSections() {
    collapsedSectionKeys.clear();
  }

  $effect(() => {
    const keys = clipSections.map((section) => section.key);
    const valid = new Set(keys);
    for (const key of Array.from(collapsedSectionKeys)) {
      if (!valid.has(key)) {
        collapsedSectionKeys.delete(key);
      }
    }
  });

  function closeContextMenu() {
    contextMenu.open = false;
    contextMenu.clip = null;
  }

  function openContextMenu(event: MouseEvent, clip: Clip) {
    event.preventDefault();
    event.stopPropagation();
    handleClipClick(clip);

    const padding = 8;
    const menuWidth = 180;
    const menuHeight = 44;
    let x = event.clientX;
    let y = event.clientY;

    if (x + menuWidth > window.innerWidth - padding) {
      x = Math.max(padding, window.innerWidth - menuWidth - padding);
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = Math.max(padding, window.innerHeight - menuHeight - padding);
    }

    contextMenu.open = true;
    contextMenu.x = x;
    contextMenu.y = y;
    contextMenu.clip = clip;
  }

  function handleContextDelete() {
    if (!contextMenu.clip) return;
    const clipId = contextMenu.clip.id;
    closeContextMenu();
    void executeDeleteClip(clipId);
  }

  $effect(() => {
    if (!contextMenu.open) return;
    const handleWindowClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.clip-context-menu')) return;
      closeContextMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    window.addEventListener('click', handleWindowClick);
    window.addEventListener('contextmenu', handleWindowClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('contextmenu', handleWindowClick);
      window.removeEventListener('keydown', handleEscape);
    };
  });
  
  // Format duration
  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  function toChapterLocal(seconds: number): number {
    const local = Math.max(0, seconds - chapterStartTime);
    if (chapterDuration === null || !Number.isFinite(chapterDuration)) {
      return local;
    }

    const maxDuration = Math.max(0, chapterDuration);
    return Math.min(local, maxDuration);
  }
</script>

<div
  class={cn(
    'beat-panel flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border-default bg-surface-base',
    className,
  )}
>
  <div class="flex items-center justify-between border-b border-border-default bg-surface-base px-[14px] py-3">
    <h3 class="m-0 text-app-base font-semibold text-text-primary">Clips</h3>
    <div class="flex items-center gap-2">
      <span class="font-mono text-app-xs text-text-tertiary">{clips.length} total</span>
      {#if clipSections.length > 0}
        <button
          class="rounded-[4px] border border-border-default bg-transparent px-2 py-1 text-app-xs text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
          onclick={hasAnyCollapsedSections ? expandAllSections : collapseAllSections}
        >
          {hasAnyCollapsedSections ? 'Expand Sections' : 'Collapse Sections'}
        </button>
      {/if}
      <button
        class="rounded-[4px] border border-transparent bg-transparent px-2 py-1 text-app-xs text-text-secondary transition-all hover:bg-surface-hover hover:text-text-primary"
        onclick={collapseBeat}
      >
        Hide
      </button>
    </div>
  </div>
  
  <div class="clip-groups scrollbar-thin flex-1 overflow-y-auto p-2">
    {#each clipSections as section (section.key)}
      {@const roleClips = section.clips}
      {@const config = section.config}
      
      <div class="mb-3 border-b border-border-subtle pb-2 last:mb-0 last:border-b-0 last:pb-0">
        <button
          class="mb-1 flex w-full items-center gap-2 rounded-r-[4px] border-y-0 border-r-0 border-l-[3px] bg-transparent px-2 py-1.5 text-left text-inherit transition-colors hover:bg-surface-hover"
          style="background-color: {config.subtleCssVar}; border-left-color: {config.cssVar}"
          onclick={() => toggleSection(section.key)}
          aria-expanded={!isSectionCollapsed(section.key)}
        >
          <span class="inline-flex w-3 items-center justify-center text-text-tertiary">
            <Icon icon={isSectionCollapsed(section.key) ? ChevronRight : ChevronDown} size={14} />
          </span>
          <span class="inline-flex items-center"><Icon icon={config.icon} size={14} /></span>
          <span class="flex-1 text-app-sm font-medium text-text-primary">{config.label}</span>
          <span class="font-mono text-app-xs text-text-tertiary">{roleClips.length}</span>
        </button>
        
        {#if !isSectionCollapsed(section.key)}
          <div class="ml-1.5 flex flex-col border-l border-border-subtle pl-3.5">
            {#each roleClips as clip (clip.id)}
              {@const localStart = toChapterLocal(clip.in_point)}
              {@const localEnd = toChapterLocal(clip.out_point)}
              {@const isSelected = timelineState.selectedClipIds.has(clip.id)}
              <div 
                class="mb-px cursor-pointer rounded-r-[4px] border-l-2 border-l-transparent px-2 py-1.5 transition-all hover:bg-surface-hover"
                class:bg-surface-hover={isSelected}
                class:border-l-accent-primary={isSelected}
                class:opacity-50={!clip.is_essential}
                onclick={() => handleClipClick(clip)}
                oncontextmenu={(event) => openContextMenu(event, clip)}
                onkeydown={(e) => e.key === 'Enter' && handleClipClick(clip)}
                role="button"
                tabindex="0"
                aria-haspopup="menu"
              >
                <div class="mb-0.5 flex items-center gap-1 font-mono text-app-xs text-text-tertiary">
                  <span>{formatDuration(localStart)}</span>
                  <span class="opacity-60">→</span>
                  <span>{formatDuration(localEnd)}</span>
                </div>
                
                <div class="flex items-center justify-between gap-2">
                  {#if clip.description}
                    <span class="flex-1 truncate text-app-sm text-text-secondary">{clip.description}</span>
                  {:else}
                    <span class="flex-1 truncate text-app-sm italic text-text-tertiary">No description</span>
                  {/if}
                  
                  <div class="flex shrink-0 items-center gap-1">
                    <span class="font-mono text-app-xs text-text-tertiary">T{clip.track_index + 1}</span>
                    {#if clip.is_essential}
                      <span class="inline-flex items-center text-accent-warning" title="Essential"><Icon icon={Star} size={12} /></span>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    
    {#if clips.length === 0}
      <div class="flex flex-col items-center justify-center p-8 text-center text-text-tertiary">
        <p class="mb-2 font-medium text-text-secondary">No clips yet</p>
        <p class="text-app-sm">Add clips to your timeline to see them here</p>
      </div>
    {/if}
  </div>

  {#if contextMenu.open}
    <div
      class="clip-context-menu fixed z-50 min-w-40 rounded-[4px] border border-border-default bg-surface-raised p-1"
      style={`top: ${contextMenu.y}px; left: ${contextMenu.x}px;`}
      role="menu"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          closeContextMenu();
        }
      }}
      oncontextmenu={(event) => event.preventDefault()}
    >
      <button
        class="w-full rounded-[4px] bg-transparent px-3 py-2 text-left text-app-sm text-role-setup transition-colors hover:bg-surface-hover hover:text-text-primary"
        role="menuitem"
        onclick={handleContextDelete}
      >
        Delete clip
      </button>
    </div>
  {/if}
</div>
