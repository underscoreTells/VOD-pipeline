<script lang="ts">
  let { lang = "", text = "" } = $props<{
    lang?: string;
    text?: string;
  }>();

  const languageClass = $derived.by(() => (lang ? `language-${lang}` : undefined));
</script>

<pre class="markdown-code-block"><code class={languageClass}>{text}</code></pre>
