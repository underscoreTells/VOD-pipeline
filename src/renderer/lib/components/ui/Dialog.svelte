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
  <div class="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center">
    <button
      type="button"
      class="absolute inset-0 bg-black/60"
      aria-label="Close dialog"
      onclick={onClose}
    ></button>
    <div
      class="relative z-10 flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-md border border-border-default bg-surface-raised"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Dialog'}
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
