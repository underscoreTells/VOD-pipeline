<script lang="ts">
  import type { Snippet } from "svelte";
  import { isSafeMarkdownHref } from "../../utils/markdown.js";

  let { children, href = "", title = undefined } = $props<{
    children?: Snippet;
    href?: string;
    title?: string;
  }>();

  const safeHref = $derived.by(() => (isSafeMarkdownHref(href) ? href : null));
</script>

{#if safeHref}
  <a href={safeHref} {title} target="_blank" rel="noopener noreferrer">
    {@render children?.()}
  </a>
{:else}
  <span>
    {@render children?.()}
  </span>
{/if}
