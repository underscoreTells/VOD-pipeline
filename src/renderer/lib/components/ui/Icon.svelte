<script lang="ts">
  import type { Snippet } from 'svelte/elements';
  import type { LucideIcon } from 'lucide-svelte';

  interface Props {
    icon: LucideIcon;
    size?: number;
    class?: string;
    title?: string;
  }

  let { icon: Icon, size = 18, class: className = '', title }: Props = $props();
</script>

<span class="icon-wrapper {className}" title={title}>
  <Icon size={size} />
</span>

<style>
  .icon-wrapper {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    flex-shrink: 0;
    color: currentColor;
  }
</style>
