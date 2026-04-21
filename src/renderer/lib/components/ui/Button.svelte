<script lang="ts">
  import type { Snippet } from 'svelte/elements';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
  type Size = 'sm' | 'md';

  interface Props extends HTMLButtonAttributes {
    variant?: Variant;
    size?: Size;
    icon?: LucideIcon;
    iconRight?: LucideIcon;
    disabled?: boolean;
    children?: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    disabled = false,
    children,
    class: className = '',
    ...rest
  }: Props = $props();
</script>

<button
  class="btn btn-{variant} btn-{size} {className}"
  {disabled}
  {...rest}
>
  {#if icon}
    <Icon icon={icon} size={size === 'sm' ? 14 : 16} />
  {/if}
  {#if children}
    {@render children()}
  {/if}
  {#if iconRight}
    <Icon icon={iconRight} size={size === 'sm' ? 14 : 16} />
  {/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    font-family: var(--font-sans);
    font-weight: var(--weight-medium);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition-fast) ease;
    white-space: nowrap;
    line-height: 1;
  }

  .btn:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 1px;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-md {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-base);
  }

  .btn-sm {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
  }

  .btn-primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-primary-hover);
    border-color: var(--accent-primary-hover);
  }

  .btn-primary:active:not(:disabled) {
    background: var(--accent-primary-active);
  }

  .btn-secondary {
    background: var(--surface-elevated);
    color: var(--text-secondary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .btn-ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-secondary);
  }

  .btn-ghost:hover:not(:disabled) {
    background: var(--surface-elevated);
    color: var(--text-primary);
  }

  .btn-destructive {
    background: var(--accent-destructive);
    border-color: var(--accent-destructive);
    color: #fff;
  }

  .btn-destructive:hover:not(:disabled) {
    background: var(--accent-destructive-hover);
    border-color: var(--accent-destructive-hover);
  }
</style>
