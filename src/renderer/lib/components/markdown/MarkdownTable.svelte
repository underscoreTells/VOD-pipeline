<script lang="ts">
  import type { Snippet } from "svelte";

  let { children } = $props<{ children?: Snippet }>();
</script>

<div class="markdown-table-scroll">
  <table>
    {@render children?.()}
  </table>
</div>
