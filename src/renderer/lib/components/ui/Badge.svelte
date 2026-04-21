<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';
  import { cn } from '../../utils/cn';

  type Variant = 'default' | 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition' | 'unassigned' | 'essential' | 'success' | 'warning' | 'destructive';

  interface Props {
    variant?: Variant;
    icon?: LucideIcon;
    class?: string;
    children?: Snippet;
  }

  let { variant = 'default', icon, class: className = '', children }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    default: 'border-border-subtle bg-surface-elevated text-text-secondary',
    setup: 'border-[color:color-mix(in_srgb,var(--role-setup)_22%,transparent)] bg-role-setup-subtle text-role-setup',
    escalation: 'border-[color:color-mix(in_srgb,var(--role-escalation)_22%,transparent)] bg-role-escalation-subtle text-role-escalation',
    twist: 'border-[color:color-mix(in_srgb,var(--role-twist)_22%,transparent)] bg-role-twist-subtle text-role-twist',
    payoff: 'border-[color:color-mix(in_srgb,var(--role-payoff)_22%,transparent)] bg-role-payoff-subtle text-role-payoff',
    transition: 'border-[color:color-mix(in_srgb,var(--role-transition)_22%,transparent)] bg-role-transition-subtle text-role-transition',
    unassigned: 'border-border-subtle bg-surface-active text-role-unassigned',
    essential: 'border-[color:color-mix(in_srgb,var(--accent-warning)_22%,transparent)] bg-accent-warning-subtle text-accent-warning',
    success: 'border-[color:color-mix(in_srgb,var(--accent-success)_22%,transparent)] bg-accent-success-subtle text-accent-success',
    warning: 'border-[color:color-mix(in_srgb,var(--accent-warning)_22%,transparent)] bg-accent-warning-subtle text-accent-warning',
    destructive: 'border-[color:color-mix(in_srgb,var(--accent-destructive)_65%,transparent)] bg-accent-destructive text-white',
  };
</script>

<span class={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] border px-2 py-0.5 text-app-xs font-medium leading-[1.4]', variantClasses[variant], className)}>
  {#if icon}
    <Icon {icon} size={12} />
  {/if}
  {#if children}
    {@render children()}
  {/if}
</span>
