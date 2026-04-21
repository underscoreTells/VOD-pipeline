<script lang="ts">
  import type { Snippet } from 'svelte/elements';
  import type { HTMLAttributes } from 'svelte/elements';

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
    class="context-menu"
    style="left: {adjustPosition().left}; top: {adjustPosition().top}"
  >
    {#each items as item}
      <button
        class="context-menu-item {item.destructive ? 'destructive' : ''}"
        onclick={() => { item.action(); onclose(); }}
        disabled={item.disabled}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: var(--z-context-menu);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    padding: var(--space-1) 0;
    min-width: 140px;
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    color: var(--text-primary);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast) ease;
  }

  .context-menu-item:hover:not(:disabled) {
    background: var(--surface-elevated);
  }

  .context-menu-item.destructive {
    color: var(--accent-destructive);
  }

  .context-menu-item.destructive:hover:not(:disabled) {
    background: var(--accent-destructive);
    color: #fff;
  }

  .context-menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
