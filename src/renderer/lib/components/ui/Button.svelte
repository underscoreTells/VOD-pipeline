<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import { cn } from '../../utils/cn';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
  type Size = 'sm' | 'md' | 'icon';

  interface Props extends HTMLButtonAttributes {
    variant?: Variant;
    size?: Size;
    icon?: any;
    iconRight?: any;
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
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium leading-none transition-all duration-120 ease-out active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-border-focus';

  const sizeClasses: Record<Size, string> = {
    md: 'h-9 px-4 py-2 text-app-base',
    sm: 'h-7 px-3 py-1 text-app-sm',
    icon: 'h-9 w-9 p-0',
  };

  const variantClasses: Record<Variant, string> = {
    primary:
      'border-transparent bg-accent-primary text-white hover:opacity-90',
    secondary:
      'border-border-default bg-surface-base text-text-primary hover:bg-surface-elevated',
    ghost:
      'border-transparent bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary',
    destructive:
      'border-transparent bg-accent-destructive text-white hover:opacity-90',
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