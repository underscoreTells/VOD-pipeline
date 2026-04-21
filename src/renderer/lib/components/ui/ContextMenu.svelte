<script lang="ts">
  import { cn } from '../../utils/cn';

  interface MenuItem {
    label: string;
    action: () => void;
    destructive?: boolean;
    disabled?: boolean;
  }

  interface Props {
    items: MenuItem[];
    x: number;
    y: number;
    onclose: () => void;
  }

  let { items, x, y, onclose }: Props = $props();

  let menuRef: HTMLDivElement | undefined = $state();

  function adjustPosition() {
    if (!menuRef) return { left: x + 'px', top: y + 'px' };
    const rect = menuRef.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (x + rect.width > vw) left = vw - rect.width - 8;
    if (y + rect.height > vh) top = vh - rect.height - 8;
    return { left: left + 'px', top: top + 'px' };
  }

  $effect(() => {
    if (!menuRef) return;
    function handleClick(e: MouseEvent) {
      if (menuRef && !menuRef.contains(e.target as Node)) onclose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onclose();
    }
    setTimeout(() => {
      document.addEventListener('pointerdown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      document.removeEventListener('pointerdown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  });
</script>

{#if items.length > 0}
  <div
    bind:this={menuRef}
    class="fixed z-[var(--z-context-menu)] min-w-[140px] rounded-md border border-border-default bg-surface-raised py-1 shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    style="left: {adjustPosition().left}; top: {adjustPosition().top}"
  >
    {#each items as item}
      <button
        class={cn(
          'block w-full px-3 py-2 text-left text-app-base transition-colors disabled:pointer-events-none',
          item.destructive
            ? 'text-accent-destructive hover:bg-accent-destructive hover:text-white'
            : 'text-text-primary hover:bg-surface-elevated',
        )}
        onclick={() => { item.action(); onclose(); }}
        disabled={item.disabled}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}
