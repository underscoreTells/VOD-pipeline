<script lang="ts">
  import { timelineState, selectClip, setPlayhead } from '../state/timeline.svelte';
  import { executeDeleteClip } from '../state/project-detail.svelte';
  import { collapseBeat } from '../state/layout.svelte';
  import type { Clip } from '../../../shared/types/database';
  
  interface Props {
    clips?: Clip[];
    chapterStartTime?: number;
    chapterDuration?: number | null;
  }
  
  let { clips = timelineState.clips, chapterStartTime = 0, chapterDuration = null }: Props = $props();
  
  // Role configuration with colors and labels
  const ROLE_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
    'setup': { color: '#ef4444', label: 'Setup', icon: '🎯' },
    'escalation': { color: '#f97316', label: 'Escalation', icon: '📈' },
    'twist': { color: '#eab308', label: 'Twist', icon: '↩️' },
    'payoff': { color: '#22c55e', label: 'Payoff', icon: '🎉' },
    'transition': { color: '#3b82f6', label: 'Transition', icon: '➡️' },
    'unassigned': { color: '#6b7280', label: 'Unassigned', icon: '📝' },
  };

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
      config: { color: string; label: string; icon: string };
      clips: Clip[];
    }> = [];

    for (const clip of sortedClips) {
      const role = clip.role || 'unassigned';
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
  
  <div class="clip-groups">
    {#each clipSections as section (section.key)}
      {@const roleClips = section.clips}
      {@const config = section.config}
      
      <div class="role-group">
        <button
          class="role-header"
          style="background-color: {config.color}20; border-left-color: {config.color}"
          onclick={() => toggleSection(section.key)}
          aria-expanded={!isSectionCollapsed(section.key)}
        >
          <span class="section-expand-icon">{isSectionCollapsed(section.key) ? '▸' : '▾'}</span>
          <span class="role-icon">{config.icon}</span>
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
                      <span class="essential-badge" title="Essential">★</span>
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
    background: #1a1a1a;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid #333;
    background: #1e1e1e;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .panel-header h3 {
    margin: 0;
    font-size: 1rem;
    color: #fff;
  }
  
  .clip-count {
    font-size: 0.75rem;
    color: #888;
    background: #333;
    padding: 0.25rem 0.5rem;
    border-radius: 12px;
  }

  .collapse-btn {
    padding: 0.25rem 0.5rem;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #ccc;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .collapse-btn:hover {
    background: #444;
    color: #fff;
  }

  .section-toggle-btn {
    padding: 0.25rem 0.5rem;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #c7c7c7;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .section-toggle-btn:hover {
    background: #343434;
    color: #fff;
  }
  
  .clip-groups {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }
  
  .role-group {
    margin-bottom: 1rem;
  }
  
  .role-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-left: 3px solid;
    border-top: none;
    border-right: none;
    border-bottom: none;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    width: 100%;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }

  .role-header:hover {
    filter: brightness(1.08);
  }

  .section-expand-icon {
    color: #bbb;
    font-size: 0.8rem;
    width: 0.75rem;
    text-align: center;
  }
  
  .role-icon {
    font-size: 1rem;
  }
  
  .role-label {
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    flex: 1;
  }
  
  .role-count {
    font-size: 0.75rem;
    color: #888;
    background: #00000040;
    padding: 0.125rem 0.375rem;
    border-radius: 10px;
  }
  
  .clip-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  
  .clip-item {
    padding: 0.5rem;
    background: #252525;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid transparent;
  }
  
  .clip-item:hover {
    background: #2a2a2a;
    border-color: #444;
  }
  
  .clip-item.selected {
    background: #3b82f620;
    border-color: #3b82f6;
  }

  .clip-context-menu {
    position: fixed;
    z-index: 50;
    min-width: 160px;
    padding: 0.25rem;
    background: #1f1f1f;
    border: 1px solid #333;
    border-radius: 6px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }

  .context-item {
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    color: #ddd;
    font-size: 0.875rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .context-item:hover {
    background: #2a2a2a;
    color: #fff;
  }

  .context-item.destructive {
    color: #f87171;
  }
  
  .clip-item.discarded {
    opacity: 0.5;
  }
  
  .clip-time {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: #888;
    margin-bottom: 0.25rem;
    font-family: 'SF Mono', Monaco, monospace;
  }
  
  .time-separator {
    color: #666;
  }
  
  .clip-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  
  .clip-description {
    font-size: 0.875rem;
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  
  .clip-description.empty {
    color: #666;
    font-style: italic;
  }
  
  .clip-meta {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  
  .track-badge {
    font-size: 0.625rem;
    color: #888;
    background: #333;
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
  }
  
  .essential-badge {
    font-size: 0.75rem;
    color: #fbbf24;
  }
  
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: #666;
    text-align: center;
  }
  
  .empty-state p:first-child {
    font-weight: 500;
    margin-bottom: 0.5rem;
  }
  
  .hint {
    font-size: 0.75rem;
  }
</style>
