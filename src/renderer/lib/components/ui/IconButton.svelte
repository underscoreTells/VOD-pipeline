<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';
  import { cn } from '../../utils/cn';

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

  const variantClasses: Record<Variant, string> = {
    default:
      'text-text-tertiary hover:bg-surface-elevated hover:text-text-primary active:bg-surface-active',
    destructive:
      'text-text-tertiary hover:bg-accent-destructive hover:text-white',
  };
</script>

<button
  class={cn(
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-transparent transition-colors disabled:pointer-events-none',
    variantClasses[variant],
    className,
  )}
  {disabled}
  {title}
  {...rest}
>
  <Icon {icon} {size} />
</button>
