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

<span class={`inline-flex shrink-0 items-center justify-center leading-none text-current ${className}`} title={title}>
  <Icon size={size} />
</span>
