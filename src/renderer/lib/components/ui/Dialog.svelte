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
  <div
    class="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
    role="presentation"
    tabindex="-1"
    onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose?.()}
  >
    <div
      class="flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-lg border border-border-default bg-surface-raised shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
      onclick={(e) => e.stopPropagation()}
    >
      {#if title}
        <div class="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 class="m-0 text-app-lg font-semibold text-text-primary">{title}</h2>
          {#if onClose}
            <IconButton icon={X} size={18} onclick={onClose} title="Close" />
          {/if}
        </div>
      {/if}
      <div class="overflow-y-auto p-5">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
