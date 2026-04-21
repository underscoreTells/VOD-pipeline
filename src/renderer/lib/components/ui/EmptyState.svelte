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

<div class="empty-state">
  {#if icon}
    <div class="empty-icon">
      <Icon {icon} size={40} />
    </div>
  {/if}
  {#if title}
    <p class="empty-title">{title}</p>
  {/if}
  {#if description}
    <p class="empty-description">{description}</p>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    text-align: center;
    flex: 1;
  }

  .empty-icon {
    color: var(--text-disabled);
    margin-bottom: var(--space-4);
  }

  .empty-title {
    font-size: var(--text-md);
    color: var(--text-tertiary);
    margin: 0 0 var(--space-2);
  }

  .empty-description {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    margin: 0;
  }
</style>
