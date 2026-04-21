<script lang="ts">
  import type { Snippet } from 'svelte/elements';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';
  import { cn } from '../../utils/cn';

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

  const baseClass =
    'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-sm border font-medium leading-none transition-colors disabled:pointer-events-none';

  const sizeClasses: Record<Size, string> = {
    md: 'px-3 py-2 text-app-base',
    sm: 'px-2 py-1 text-app-sm',
  };

  const variantClasses: Record<Variant, string> = {
    primary:
      'border-accent-primary bg-accent-primary text-white hover:border-accent-primary-hover hover:bg-accent-primary-hover active:bg-accent-primary-active',
    secondary:
      'border-border-default bg-surface-elevated text-text-secondary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary',
    ghost:
      'border-transparent bg-transparent text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
    destructive:
      'border-accent-destructive bg-accent-destructive text-white hover:border-accent-destructive-hover hover:bg-accent-destructive-hover',
  };
</script>

<button
  class={cn(baseClass, sizeClasses[size], variantClasses[variant], className)}
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
