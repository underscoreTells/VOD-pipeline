<script lang="ts">
  import type { Clip } from '$shared/types/database';
  import { compareClipsBySourceTime } from '$shared/utils/clip-timing.js';
  import { ROLE_CONFIG, ROLE_KEYS, Star } from '../constants.js';
  import type { ClipRole } from '../constants.js';
  import { collapseBeat } from '../state/layout.svelte.js';
  import { executeDeleteClip } from '../state/project-detail.svelte.js';
  import { selectClip, setPlayhead, timelineState } from '../state/timeline.svelte.js';
  import { cn } from '../utils/cn.js';
  import Icon from './ui/Icon.svelte';

  interface Props {
    class?: string;
    clips?: Clip[];
    chapterStartTime?: number;
  }

  let {
    class: className = '',
    clips = timelineState.clips,
    chapterStartTime = 0,
  }: Props = $props();
  let roleFilter = $state<ClipRole | 'all'>('all');

  const sortedCuts = $derived.by(() => [...clips]
    .filter((clip) => roleFilter === 'all' || (clip.role || 'unassigned') === roleFilter)
    .sort(compareClipsBySourceTime));

  function formatTime(seconds: number): string {
    const local = Math.max(0, seconds - chapterStartTime);
    const minutes = Math.floor(local / 60);
    const secs = Math.floor(local % 60);
    const hundredths = Math.floor((local % 1) * 100);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  }

  function selectCut(clip: Clip): void {
    selectClip(clip.id, false);
    setPlayhead(clip.in_point);
  }
</script>

<aside class={cn('flex h-full min-h-0 flex-col overflow-hidden border-l border-border-default bg-surface-base', className)} aria-label="Chapter cuts">
  <header class="border-b border-border-default px-3 py-3">
    <div class="flex items-center justify-between gap-2">
      <div>
        <h3 class="m-0 text-app-base font-semibold text-text-primary">Cuts</h3>
        <p class="m-0 mt-0.5 text-app-xs text-text-tertiary">{clips.length} retained range{clips.length === 1 ? '' : 's'}</p>
      </div>
      <button class="rounded-sm px-2 py-1 text-app-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary" onclick={collapseBeat}>Hide</button>
    </div>
    <div class="scrollbar-thin mt-3 flex gap-1 overflow-x-auto pb-1" aria-label="Filter cuts by narrative role">
      <button class="shrink-0 rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.05em]" class:border-accent-primary={roleFilter === 'all'} class:bg-accent-primary-subtle={roleFilter === 'all'} class:text-accent-primary={roleFilter === 'all'} class:border-border-default={roleFilter !== 'all'} class:text-text-tertiary={roleFilter !== 'all'} onclick={() => roleFilter = 'all'}>All</button>
      {#each ROLE_KEYS as role (role)}
        {@const config = ROLE_CONFIG[role]}
        <button
          class="shrink-0 rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.05em]"
          class:border-border-default={roleFilter !== role}
          class:text-text-tertiary={roleFilter !== role}
          style={roleFilter === role ? `border-color:${config.cssVar};background:${config.subtleCssVar};color:${config.cssVar}` : undefined}
          onclick={() => roleFilter = role}
        >{config.label}</button>
      {/each}
    </div>
  </header>

  <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
    {#if sortedCuts.length === 0}
      <div class="flex h-full min-h-32 flex-col items-center justify-center px-5 text-center">
        <p class="m-0 text-app-sm font-medium text-text-secondary">No cuts in this view</p>
        <p class="m-0 mt-2 text-app-xs leading-[1.5] text-text-tertiary">Drag an empty timeline lane to retain a range, or ask the agent for suggested cuts.</p>
      </div>
    {:else}
      <ol class="m-0 flex list-none flex-col gap-1 p-0">
        {#each sortedCuts as clip, index (clip.id)}
          {@const selected = timelineState.selectedClipIds.has(clip.id)}
          {@const role = (clip.role || 'unassigned') as ClipRole}
          {@const config = ROLE_CONFIG[role] || ROLE_CONFIG.unassigned}
          <li>
            <div
              class="group/cut relative w-full rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:border-border-default hover:bg-surface-hover"
              class:border-accent-primary={selected}
              class:bg-accent-primary-subtle={selected}
              onclick={() => selectCut(clip)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  selectCut(clip);
                }
              }}
              role="button"
              tabindex="0"
            >
              <span class="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={`background:${config.cssVar}`}></span>
              <span class="flex items-center gap-2">
                <span class="w-5 shrink-0 font-mono text-[10px] tabular-nums text-text-disabled">{String(index + 1).padStart(2, '0')}</span>
                <span class="min-w-0 flex-1 truncate text-app-sm font-medium text-text-primary">{clip.description || 'Untitled cut'}</span>
                {#if clip.is_essential}<span class="text-accent-warning" title="Essential"><Icon icon={Star} size={11} /></span>{/if}
              </span>
              <span class="mt-1 flex items-center gap-2 pl-7 font-mono text-[10px] tabular-nums text-text-tertiary">
                <span>{formatTime(clip.in_point)}</span><span>→</span><span>{formatTime(clip.out_point)}</span>
                <span class="ml-auto font-sans uppercase tracking-[0.05em]" style={`color:${config.cssVar}`}>{config.label}</span>
              </span>
              <span class="pointer-events-none absolute right-2 top-2 opacity-0 transition-opacity group-hover/cut:pointer-events-auto group-hover/cut:opacity-100 group-focus-within/cut:pointer-events-auto group-focus-within/cut:opacity-100">
                <button
                  type="button"
                  class="pointer-events-auto rounded-sm px-1.5 py-1 text-[10px] text-accent-destructive hover:bg-accent-destructive hover:text-white"
                  onclick={(event) => { event.stopPropagation(); void executeDeleteClip(clip.id); }}
                >Delete</button>
              </span>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</aside>
