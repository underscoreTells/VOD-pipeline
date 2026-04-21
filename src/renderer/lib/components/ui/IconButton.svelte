<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';

  type Variant = 'default' | 'destructive';

  interface Props extends HTMLButtonAttributes {
    icon: LucideIcon;
    variant?: Variant;
    size?: number;
    title?: string;
    disabled?: boolean;
  }

  let {
    icon,
    variant = 'default',
    size = 16,
    title,
    disabled = false,
    class: className = '',
    ...rest
  }: Props = $props();
</script>

<button
  class="icon-btn icon-btn-{variant} {className}"
  {disabled}
  {title}
  {...rest}
>
  <Icon {icon} {size} />
</button>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all var(--transition-fast) ease;
    flex-shrink: 0;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--surface-elevated);
    color: var(--text-primary);
  }

  .icon-btn:active:not(:disabled) {
    background: var(--surface-active);
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 1px;
  }

  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .icon-btn-destructive {
    color: var(--text-tertiary);
  }

  .icon-btn-destructive:hover:not(:disabled) {
    background: var(--accent-destructive);
    color: #fff;
  }
</style>
