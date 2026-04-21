<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { LucideIcon } from 'lucide-svelte';
  import IconButton from './IconButton.svelte';

  type Variant = 'default' | 'destructive';

  interface Props extends HTMLButtonAttributes {
    icon: LucideIcon;
    tooltip: string;
    variant?: Variant;
    size?: number;
    disabled?: boolean;
  }

  let {
    icon,
    tooltip,
    variant = 'default',
    size = 16,
    disabled = false,
    class: className = '',
    ...rest
  }: Props = $props();
</script>

<div class="group/tooltip relative inline-flex shrink-0">
  <IconButton
    {icon}
    {variant}
    {size}
    {disabled}
    class={className}
    aria-label={tooltip}
    {...rest}
  />
  <span
    class="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-[var(--z-float)] -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-border-subtle bg-surface-elevated px-2 py-1 text-[11px] font-medium text-text-secondary opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.16)] transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
    aria-hidden="true"
  >
    {tooltip}
  </span>
</div>
