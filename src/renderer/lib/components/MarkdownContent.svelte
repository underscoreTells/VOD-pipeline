<script lang="ts">
  import SvelteMarkdown from "svelte-markdown";
  import MarkdownCodeBlock from "./markdown/MarkdownCodeBlock.svelte";
  import MarkdownHtml from "./markdown/MarkdownHtml.svelte";
  import MarkdownLink from "./markdown/MarkdownLink.svelte";
  import MarkdownTable from "./markdown/MarkdownTable.svelte";
  import { CHAT_MARKDOWN_OPTIONS, prepareMarkdownSource } from "../utils/markdown.js";

  let { content, role = "assistant" } = $props<{
    content: string;
    role?: "user" | "assistant" | "system";
  }>();

  const markdownSource = $derived.by(() => prepareMarkdownSource(content));
  const renderers = {
    code: MarkdownCodeBlock,
    html: MarkdownHtml,
    link: MarkdownLink,
    table: MarkdownTable,
  };
</script>

<div class={`markdown-content ${role}`}>
  <SvelteMarkdown source={markdownSource} options={CHAT_MARKDOWN_OPTIONS} {renderers} />
</div>

<style>
  .markdown-content {
    font-size: var(--text-base);
    line-height: 1.6;
    min-width: 0;
  }

  .markdown-content :global(*) {
    min-width: 0;
  }

  .markdown-content :global(h1),
  .markdown-content :global(h2),
  .markdown-content :global(h3),
  .markdown-content :global(h4),
  .markdown-content :global(h5),
  .markdown-content :global(h6) {
    margin: 0 0 var(--space-3);
    line-height: 1.25;
  }

  .markdown-content :global(h1) {
    font-size: var(--text-xl);
  }

  .markdown-content :global(h2) {
    font-size: var(--text-lg);
  }

  .markdown-content :global(h3) {
    font-size: var(--text-md);
  }

  .markdown-content :global(p),
  .markdown-content :global(ul),
  .markdown-content :global(ol),
  .markdown-content :global(blockquote),
  .markdown-content :global(pre),
  .markdown-content :global(.markdown-table-scroll),
  .markdown-content :global(hr) {
    margin: 0 0 var(--space-3);
  }

  .markdown-content :global(p:last-child),
  .markdown-content :global(ul:last-child),
  .markdown-content :global(ol:last-child),
  .markdown-content :global(blockquote:last-child),
  .markdown-content :global(pre:last-child),
  .markdown-content :global(.markdown-table-scroll:last-child),
  .markdown-content :global(hr:last-child) {
    margin-bottom: 0;
  }

  .markdown-content :global(ul),
  .markdown-content :global(ol) {
    padding-left: var(--space-5);
  }

  .markdown-content :global(li + li) {
    margin-top: var(--space-1);
  }

  .markdown-content :global(blockquote) {
    border-left: 3px solid var(--border-default);
    padding-left: var(--space-3);
    color: var(--text-secondary);
  }

  .markdown-content :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .markdown-content :global(:not(pre) > code) {
    display: inline-block;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
  }

  .markdown-content :global(.markdown-code-block) {
    overflow-x: auto;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface-elevated);
    border: 1px solid var(--border-subtle);
  }

  .markdown-content :global(pre code) {
    display: block;
    white-space: pre;
  }

  .markdown-content :global(.markdown-table-scroll) {
    overflow-x: auto;
  }

  .markdown-content :global(table) {
    border-collapse: collapse;
    min-width: 100%;
    width: max-content;
  }

  .markdown-content :global(th),
  .markdown-content :global(td) {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-subtle);
    text-align: left;
    vertical-align: top;
  }

  .markdown-content :global(th) {
    font-weight: var(--weight-semibold);
    background: var(--surface-raised);
  }

  .markdown-content :global(hr) {
    border: 0;
    border-top: 1px solid var(--border-default);
  }

  .markdown-content :global(a) {
    color: inherit;
    text-decoration: underline;
    text-decoration-thickness: 0.08em;
    text-underline-offset: 0.16em;
  }

  .markdown-content :global(a:hover) {
    opacity: 0.9;
  }

  .markdown-content.user :global(:not(pre) > code) {
    background: var(--accent-primary-subtle);
  }

  .markdown-content.user :global(.markdown-code-block) {
    background: var(--surface-elevated);
  }
</style>
