<script lang="ts">
  interface Props {
    value: number;
    max?: number;
    label?: string;
  }

  let { value, max = 100, label }: Props = $props();
  let percent = $derived(Math.min(100, Math.max(0, (value / max) * 100)));
</script>

<div class="progress-bar">
  {#if label}
    <span class="progress-label">{label}</span>
  {/if}
  <div class="progress-track">
    <div class="progress-fill" style="width: {percent}%"></div>
  </div>
</div>

<style>
  .progress-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .progress-track {
    flex: 1;
    height: 4px;
    background: var(--surface-elevated);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent-primary);
    border-radius: var(--radius-pill);
    transition: width var(--transition-normal) ease;
  }

  .progress-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }
</style>
