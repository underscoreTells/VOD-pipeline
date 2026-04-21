<script lang="ts">
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';
  import { cn } from '../../utils/cn';

  type Variant = 'default' | 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition' | 'unassigned' | 'essential' | 'success' | 'warning' | 'destructive';

  interface Props {
    variant?: Variant;
    icon?: LucideIcon;
    children: any;
  }

  let { variant = 'default', icon, children }: Props = $props();

  const variantClasses: Record<Variant, string> = {
    default: 'bg-surface-elevated text-text-secondary',
    setup: 'bg-role-setup-subtle text-role-setup',
    escalation: 'bg-role-escalation-subtle text-role-escalation',
    twist: 'bg-role-twist-subtle text-role-twist',
    payoff: 'bg-role-payoff-subtle text-role-payoff',
    transition: 'bg-role-transition-subtle text-role-transition',
    unassigned: 'bg-role-unassigned-subtle text-role-unassigned',
    essential: 'bg-accent-warning-subtle text-accent-warning',
    success: 'bg-accent-success-subtle text-accent-success',
    warning: 'bg-accent-warning-subtle text-accent-warning',
    destructive: 'bg-accent-destructive text-white',
  };
</script>

<span class={cn('inline-flex items-center gap-[3px] whitespace-nowrap rounded-full px-1.5 py-px text-app-xs font-medium leading-[1.4]', variantClasses[variant])}>
  {#if icon}
    <Icon {icon} size={12} />
  {/if}
  {children}
</span>
