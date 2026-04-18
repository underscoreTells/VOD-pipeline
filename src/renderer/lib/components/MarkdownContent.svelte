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
    font-size: 14px;
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
    margin: 0 0 0.65rem;
    line-height: 1.25;
  }

  .markdown-content :global(h1) {
    font-size: 1.25rem;
  }

  .markdown-content :global(h2) {
    font-size: 1.15rem;
  }

  .markdown-content :global(h3) {
    font-size: 1.05rem;
  }

  .markdown-content :global(p),
  .markdown-content :global(ul),
  .markdown-content :global(ol),
  .markdown-content :global(blockquote),
  .markdown-content :global(pre),
  .markdown-content :global(.markdown-table-scroll),
  .markdown-content :global(hr) {
    margin: 0 0 0.8rem;
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
    padding-left: 1.25rem;
  }

  .markdown-content :global(li + li) {
    margin-top: 0.25rem;
  }

  .markdown-content :global(blockquote) {
    border-left: 3px solid rgba(255, 255, 255, 0.18);
    padding-left: 0.85rem;
    color: rgba(255, 255, 255, 0.78);
  }

  .markdown-content :global(code) {
    font-family: "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.92em;
  }

  .markdown-content :global(:not(pre) > code) {
    display: inline-block;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.42);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .markdown-content :global(.markdown-code-block) {
    overflow-x: auto;
    padding: 0.85rem 0.95rem;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
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
    padding: 0.45rem 0.65rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    text-align: left;
    vertical-align: top;
  }

  .markdown-content :global(th) {
    font-weight: 600;
    background: rgba(255, 255, 255, 0.06);
  }

  .markdown-content :global(hr) {
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.14);
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
    background: rgba(29, 78, 216, 0.28);
  }

  .markdown-content.user :global(.markdown-code-block) {
    background: rgba(30, 41, 59, 0.62);
  }
</style>
