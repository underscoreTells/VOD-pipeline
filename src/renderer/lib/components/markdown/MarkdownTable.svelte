<script lang="ts">
  import type { Snippet } from "svelte";

  let { children } = $props<{ children?: Snippet }>();
</script>

<div class="overflow-x-auto rounded-lg border border-border-default">
  <table>
    {@render children?.()}
  </table>
</div>
