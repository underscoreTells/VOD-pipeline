<script lang="ts">
  import Icon from './Icon.svelte';
  import type { LucideIcon } from 'lucide-svelte';

  type Variant = 'default' | 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition' | 'unassigned' | 'essential' | 'success' | 'warning' | 'destructive';

  interface Props {
    variant?: Variant;
    icon?: LucideIcon;
    children: any;
  }

  let { variant = 'default', icon, children }: Props = $props();
</script>

<span class="badge badge-{variant}">
  {#if icon}
    <Icon {icon} size={12} />
  {/if}
  {children}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    border-radius: var(--radius-pill);
    line-height: 1.4;
    white-space: nowrap;
  }

  .badge-default {
    background: var(--surface-elevated);
    color: var(--text-secondary);
  }

  .badge-setup {
    background: var(--role-setup-subtle);
    color: var(--role-setup);
  }

  .badge-escalation {
    background: var(--role-escalation-subtle);
    color: var(--role-escalation);
  }

  .badge-twist {
    background: var(--role-twist-subtle);
    color: var(--role-twist);
  }

  .badge-payoff {
    background: var(--role-payoff-subtle);
    color: var(--role-payoff);
  }

  .badge-transition {
    background: var(--role-transition-subtle);
    color: var(--role-transition);
  }

  .badge-unassigned {
    background: var(--role-unassigned-subtle);
    color: var(--role-unassigned);
  }

  .badge-essential {
    background: var(--accent-warning-subtle);
    color: var(--accent-warning);
  }

  .badge-success {
    background: var(--accent-success-subtle);
    color: var(--accent-success);
  }

  .badge-warning {
    background: var(--accent-warning-subtle);
    color: var(--accent-warning);
  }

  .badge-destructive {
    background: var(--accent-destructive);
    color: #fff;
  }
</style>
