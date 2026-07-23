<script lang="ts">
  import type { ChatEntityMention } from '../../../shared/types/database.js';

  let { content, mentions, onmention }: {
    content: string;
    mentions: ChatEntityMention[];
    onmention?: (mention: ChatEntityMention) => void;
  } = $props();

  type Segment =
    | { type: 'text'; value: string; key: string }
    | { type: 'mention'; mention: ChatEntityMention; key: string };

  const segments = $derived.by((): Segment[] => {
    const positioned = mentions
      .filter((mention) => mention.start !== undefined && mention.end !== undefined && mention.end <= content.length)
      .sort((a, b) => a.start! - b.start!);
    const legacy = mentions.filter((mention) => mention.start === undefined || mention.end === undefined);
    const result: Segment[] = legacy.map((mention, index) => ({
      type: 'mention',
      mention,
      key: mention.occurrenceId ?? `legacy:${mention.type}:${mention.id}:${index}`,
    }));
    let cursor = 0;
    for (const mention of positioned) {
      if (mention.start! < cursor) continue;
      if (mention.start! > cursor) {
        result.push({ type: 'text', value: content.slice(cursor, mention.start), key: `text:${cursor}` });
      }
      result.push({
        type: 'mention',
        mention,
        key: mention.occurrenceId ?? `${mention.type}:${mention.id}:${mention.start}`,
      });
      cursor = mention.end!;
    }
    if (cursor < content.length) result.push({ type: 'text', value: content.slice(cursor), key: `text:${cursor}` });
    return result;
  });
</script>

<div class="whitespace-pre-wrap break-words text-app-base leading-[1.6]">
  {#each segments as segment (segment.key)}
    {#if segment.type === 'text'}{segment.value}{:else}<button
      type="button"
      class="mx-0.5 inline-flex max-w-[16rem] translate-y-[1px] items-center rounded-md border border-[color:color-mix(in_srgb,var(--accent-primary)_40%,var(--border-default))] bg-accent-primary-subtle px-1.5 py-0.5 text-app-xs font-medium text-accent-primary transition-colors hover:border-accent-primary hover:bg-surface-hover"
      onclick={() => onmention?.(segment.mention)}
      title={`${segment.mention.type === 'clip' ? 'Open clip' : 'Open suggestion'}: ${segment.mention.label}`}
    >@{segment.mention.label}</button>{/if}
  {/each}
</div>
