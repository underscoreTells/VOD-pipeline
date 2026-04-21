<script lang="ts">
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';

  interface Props {
    icon?: LucideIcon;
    title?: string;
    description?: string;
  }

  let { icon, title, description }: Props = $props();
</script>

<div class="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
  {#if icon}
    <div class="mb-4 text-text-disabled">
      <Icon {icon} size={40} />
    </div>
  {/if}
  {#if title}
    <p class="mb-2 text-app-md text-text-tertiary">{title}</p>
  {/if}
  {#if description}
    <p class="text-app-sm text-text-disabled">{description}</p>
  {/if}
</div>
