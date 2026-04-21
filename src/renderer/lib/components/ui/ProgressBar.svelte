<script lang="ts">
  interface Props {
    value: number;
    max?: number;
    label?: string;
  }

  let { value, max = 100, label }: Props = $props();
  let percent = $derived(Math.min(100, Math.max(0, (value / max) * 100)));
</script>

<div class="flex items-center gap-2">
  {#if label}
    <span class="whitespace-nowrap text-app-xs text-text-tertiary">{label}</span>
  {/if}
  <div class="h-1 flex-1 overflow-hidden rounded-full bg-surface-elevated">
    <div class="h-full rounded-full bg-accent-primary transition-[width]" style="width: {percent}%"></div>
  </div>
</div>
