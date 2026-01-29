<script lang="ts">
  import { timelineState, selectClip, setPlayhead } from '../state/timeline.svelte';
  import type { Clip } from '../../../shared/types/database';
  
  interface Props {
    clips?: Clip[];
  }
  
  let { clips = timelineState.clips }: Props = $props();
  
  // Role configuration with colors and labels
  const ROLE_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
    'setup': { color: '#ef4444', label: 'Setup', icon: '🎯' },
    'escalation': { color: '#f97316', label: 'Escalation', icon: '📈' },
    'twist': { color: '#eab308', label: 'Twist', icon: '↩️' },
    'payoff': { color: '#22c55e', label: 'Payoff', icon: '🎉' },
    'transition': { color: '#3b82f6', label: 'Transition', icon: '➡️' },
  };
  
  // Group clips by role
  const clipsByRole = $derived.by(() => {
    const grouped = new Map<string, Clip[]>();
    
    for (const clip of clips) {
      const role = clip.role || 'unassigned';
      const existing = grouped.get(role) || [];
      existing.push(clip);
      grouped.set(role, existing);
    }
    
    return grouped;
  });
  
  // Get sorted role keys
  const sortedRoles = $derived.by(() => {
    return ['setup', 'escalation', 'twist', 'payoff', 'transition', 'unassigned'].filter(
      role => clipsByRole.has(role) && (clipsByRole.get(role)?.length || 0) > 0
    );
  });
  
  // Handle clip click
  function handleClipClick(clip: Clip) {
    selectClip(clip.id, false);
    setPlayhead(clip.start_time);
  }
  
  // Format duration
  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
</script>

<div class="beat-panel">
  <div class="panel-header">
    <h3>Clips</h3>
    <span class="clip-count">{clips.length} total</span>
  </div>
  
  <div class="clip-groups">
    {#each sortedRoles as role (role)}
      {@const roleClips = clipsByRole.get(role) || []}
      {@const config = ROLE_CONFIG[role] || { color: '#6b7280', label: 'Unassigned', icon: '📝' }}
      
      <div class="role-group">
        <div class="role-header" style="background-color: {config.color}20; border-left-color: {config.color}">
          <span class="role-icon">{config.icon}</span>
          <span class="role-label">{config.label}</span>
          <span class="role-count">{roleClips.length}</span>
        </div>
        
        <div class="clip-list">
          {#each roleClips as clip (clip.id)}
            <div 
              class="clip-item"
              class:selected={timelineState.selectedClipIds.has(clip.id)}
              class:discarded={!clip.is_essential}
              onclick={() => handleClipClick(clip)}
              onkeydown={(e) => e.key === 'Enter' && handleClipClick(clip)}
              role="button"
              tabindex="0"
            >
              <div class="clip-time">
                <span class="time-start">{formatDuration(clip.start_time)}</span>
                <span class="time-separator">→</span>
                <span class="time-end">{formatDuration(clip.start_time + (clip.out_point - clip.in_point))}</span>
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
      </div>
    {/each}
    
    {#if clips.length === 0}
      <div class="empty-state">
        <p>No clips yet</p>
        <p class="hint">Add clips to your timeline to see them here</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .beat-panel {
    width: 300px;
    height: 100%;
    background: #1a1a1a;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid #333;
    background: #1e1e1e;
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
    border-radius: 4px;
    margin-bottom: 0.5rem;
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
