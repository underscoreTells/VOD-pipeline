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

<div class={`markdown-content ${role} min-w-0 text-app-base leading-[1.6]`}>
  <SvelteMarkdown source={markdownSource} options={CHAT_MARKDOWN_OPTIONS} {renderers} />
</div>
