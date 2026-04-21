<script lang="ts">
  import { timelineState, selectClip, setPlayhead } from '../state/timeline.svelte';
  import { executeDeleteClip } from '../state/project-detail.svelte';
  import { collapseBeat } from '../state/layout.svelte';
  import type { Clip } from '../../../shared/types/database';
  import Icon from './ui/Icon.svelte';
  import { ROLE_CONFIG, ROLE_KEYS, Star, ChevronRight, ChevronDown } from '../constants';
  import type { ClipRole, RoleConfig } from '../constants';
  
  interface Props {
    clips?: Clip[];
    chapterStartTime?: number;
    chapterDuration?: number | null;
  }
  
  let { clips = timelineState.clips, chapterStartTime = 0, chapterDuration = null }: Props = $props();

  const sortedClips = $derived.by(() => {
    return [...clips].sort((a, b) => {
      if (Math.abs(a.start_time - b.start_time) > 0.0001) {
        return a.start_time - b.start_time;
      }
      return a.id - b.id;
    });
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
    setPlayhead(clip.start_time);
  }

  let contextMenu = $state({
    open: false,
    x: 0,
    y: 0,
    clip: null as Clip | null,
  });
  let collapsedSectionKeys = $state<Set<string>>(new Set());

  const hasAnyCollapsedSections = $derived.by(() => clipSections.some((section) => collapsedSectionKeys.has(section.key)));

  function isSectionCollapsed(sectionKey: string): boolean {
    return collapsedSectionKeys.has(sectionKey);
  }

  function toggleSection(sectionKey: string) {
    const next = new Set(collapsedSectionKeys);
    if (next.has(sectionKey)) {
      next.delete(sectionKey);
    } else {
      next.add(sectionKey);
    }
    collapsedSectionKeys = next;
  }

  function collapseAllSections() {
    collapsedSectionKeys = new Set(clipSections.map((section) => section.key));
  }

  function expandAllSections() {
    collapsedSectionKeys = new Set();
  }

  $effect(() => {
    const keys = clipSections.map((section) => section.key);
    const valid = new Set(keys);
    const next = new Set(Array.from(collapsedSectionKeys).filter((key) => valid.has(key)));
    if (next.size !== collapsedSectionKeys.size) {
      collapsedSectionKeys = next;
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

<div class="beat-panel">
  <div class="panel-header">
    <h3>Clips</h3>
    <div class="header-actions">
      <span class="clip-count">{clips.length} total</span>
      {#if clipSections.length > 0}
        <button class="section-toggle-btn" onclick={hasAnyCollapsedSections ? expandAllSections : collapseAllSections}>
          {hasAnyCollapsedSections ? 'Expand Sections' : 'Collapse Sections'}
        </button>
      {/if}
      <button class="collapse-btn" onclick={collapseBeat}>
        Hide
      </button>
    </div>
  </div>
  
  <div class="clip-groups scrollbar-thin">
    {#each clipSections as section (section.key)}
      {@const roleClips = section.clips}
      {@const config = section.config}
      
      <div class="role-group">
        <button
          class="role-header"
          style="background-color: {config.subtleCssVar}; border-left-color: {config.cssVar}"
          onclick={() => toggleSection(section.key)}
          aria-expanded={!isSectionCollapsed(section.key)}
        >
          <span class="section-expand-icon"><Icon icon={isSectionCollapsed(section.key) ? ChevronRight : ChevronDown} size={14} /></span>
          <span class="role-icon"><Icon icon={config.icon} size={14} /></span>
          <span class="role-label">{config.label}</span>
          <span class="role-count">{roleClips.length}</span>
        </button>
        
        {#if !isSectionCollapsed(section.key)}
          <div class="clip-list">
            {#each roleClips as clip (clip.id)}
              {@const clipDuration = Math.max(0, clip.out_point - clip.in_point)}
              {@const localStart = toChapterLocal(clip.start_time)}
              {@const localEnd = chapterDuration !== null
                ? Math.min(localStart + clipDuration, Math.max(0, chapterDuration))
                : localStart + clipDuration}
              <div 
                class="clip-item"
                class:selected={timelineState.selectedClipIds.has(clip.id)}
                class:discarded={!clip.is_essential}
                onclick={() => handleClipClick(clip)}
                oncontextmenu={(event) => openContextMenu(event, clip)}
                onkeydown={(e) => e.key === 'Enter' && handleClipClick(clip)}
                role="button"
                tabindex="0"
                aria-haspopup="menu"
              >
                <div class="clip-time">
                  <span class="time-start">{formatDuration(localStart)}</span>
                  <span class="time-separator">→</span>
                  <span class="time-end">{formatDuration(localEnd)}</span>
                </div>
                
                <div class="clip-info">
                  {#if clip.description}
                    <span class="clip-description">{clip.description}</span>
                  {:else}
                    <span class="clip-description empty">No description</span>
                  {/if}
                  
                  <div class="clip-meta">
                    <span class="track-badge">T{clip.track_index + 1}</span>
                    {#if clip.is_essential}
                      <span class="essential-badge" title="Essential"><Icon icon={Star} size={12} /></span>
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
      <div class="empty-state">
        <p>No clips yet</p>
        <p class="hint">Add clips to your timeline to see them here</p>
      </div>
    {/if}
  </div>

  {#if contextMenu.open}
    <div
      class="clip-context-menu"
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
      <button class="context-item destructive" role="menuitem" onclick={handleContextDelete}>
        Delete clip
      </button>
    </div>
  {/if}
</div>

<style>
  .beat-panel {
    width: 100%;
    height: 100%;
    background: var(--surface-base);
    border-left: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .panel-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .clip-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }

  .collapse-btn {
    padding: 4px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .collapse-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .section-toggle-btn {
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .section-toggle-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  
  .clip-groups {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2);
  }

  .role-group {
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: var(--space-2);
  }

  .role-group:last-child {
    border-bottom: none;
  }

  .role-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px 8px;
    border-left: 3px solid;
    border-top: none;
    border-right: none;
    border-bottom: none;
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    margin-bottom: var(--space-1);
    width: 100%;
    text-align: left;
    cursor: pointer;
    color: inherit;
    background: transparent;
    transition: background var(--transition-fast);
  }

  .role-header:hover {
    background: var(--surface-hover);
  }

  .section-expand-icon {
    color: var(--text-tertiary);
    width: var(--space-3);
    text-align: center;
  }

  .role-icon {
    display: inline-flex;
    align-items: center;
  }

  .role-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    flex: 1;
  }

  .role-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }
  
  .clip-list {
    display: flex;
    flex-direction: column;
    padding-left: 14px;
    border-left: 1px solid var(--border-subtle);
    margin-left: 6px;
  }

  .clip-item {
    padding: 6px 8px;
    background: transparent;
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    cursor: pointer;
    transition: all var(--transition-fast);
    border-left: 2px solid transparent;
    margin-bottom: 1px;
  }

  .clip-item:hover {
    background: var(--surface-hover);
  }

  .clip-item.selected {
    background: var(--surface-hover);
    border-left-color: var(--accent-primary);
  }

  .clip-context-menu {
    position: fixed;
    z-index: 50;
    min-width: 160px;
    padding: var(--space-1);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
  }

  .context-item {
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .context-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .context-item.destructive {
    color: var(--role-setup);
  }

  .clip-item.discarded {
    opacity: 0.5;
  }

  .clip-time {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-bottom: 2px;
    font-family: var(--font-mono);
  }

  .time-separator {
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .clip-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .clip-description {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .clip-description.empty {
    color: var(--text-tertiary);
    font-style: italic;
  }

  .clip-meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .track-badge {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }

  .essential-badge {
    display: inline-flex;
    align-items: center;
    color: var(--accent-warning);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: var(--text-tertiary);
    text-align: center;
  }

  .empty-state p:first-child {
    font-weight: var(--weight-medium);
    margin-bottom: var(--space-2);
    color: var(--text-secondary);
  }

  .hint {
    font-size: var(--text-sm);
  }
</style>
