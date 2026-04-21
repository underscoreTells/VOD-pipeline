<script lang="ts">
  let { lang = "", text = "" } = $props<{
    lang?: string;
    text?: string;
  }>();

  const languageClass = $derived.by(() => (lang ? `language-${lang}` : undefined));
</script>

<pre class="markdown-code-block overflow-x-auto rounded-lg border border-border-default bg-surface-raised p-4 text-app-sm leading-6 text-text-primary"><code class={languageClass}>{text}</code></pre>
