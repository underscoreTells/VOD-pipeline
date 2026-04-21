<script lang="ts">
  import type { Snippet } from 'svelte/elements';
  import { X } from 'lucide-svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    open: boolean;
    title?: string;
    onClose?: () => void;
    children: Snippet;
  }

  let { open, title, onClose, children }: Props = $props();
</script>

{#if open}
  <div class="dialog-backdrop" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose?.()}>
    <div class="dialog" onclick={(e) => e.stopPropagation()}>
      {#if title}
        <div class="dialog-header">
          <h2 class="dialog-title">{title}</h2>
          {#if onClose}
            <IconButton icon={X} size={18} onclick={onClose} title="Close" />
          {/if}
        </div>
      {/if}
      <div class="dialog-body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }

  .dialog {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
  }

  .dialog-title {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    margin: 0;
  }

  .dialog-body {
    padding: var(--space-5);
    overflow-y: auto;
  }
</style>
