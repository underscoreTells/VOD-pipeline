<script lang="ts">
  import type { ChatEntityMention } from '../../../shared/types/database.js';

  let {
    content,
    mentions,
    disabled = false,
    placeholder = '',
    ariaLabel = 'Message',
    class: className = '',
    onchange,
    oncursor,
    onkeydown,
    onremove,
  }: {
    content: string;
    mentions: ChatEntityMention[];
    disabled?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    class?: string;
    onchange: (content: string, mentions: ChatEntityMention[], cursor: number) => void;
    oncursor?: (cursor: number) => void;
    onkeydown?: (event: KeyboardEvent) => void;
    onremove?: (mention: ChatEntityMention) => void;
  } = $props();

  type Segment =
    | { type: 'text'; value: string; key: string }
    | { type: 'mention'; mention: ChatEntityMention; key: string };

  let editor = $state<HTMLDivElement | null>(null);
  let composing = false;
  let lastEmittedSignature = '';
  let renderedHtml = $state('');
  const MENTION_CARD_CLASS = 'mx-0.5 inline-flex items-center rounded-sm border border-[color:color-mix(in_srgb,var(--accent-primary)_35%,var(--border-default))] bg-accent-primary-subtle px-1 py-px text-[10px] font-medium leading-4 text-accent-primary transition-colors hover:border-accent-primary hover:bg-surface-hover';

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
    if (cursor < content.length) {
      result.push({ type: 'text', value: content.slice(cursor), key: `text:${cursor}` });
    }
    return result;
  });

  $effect(() => {
    const nextSegments = segments;
    const signature = getSignature(content, mentions);
    if (composing || signature === lastEmittedSignature) return;
    renderedHtml = renderHtml(nextSegments);
  });

  export function focus() {
    editor?.focus();
  }

  export function setSelectionRange(start: number, end = start) {
    if (!editor) return;
    const range = document.createRange();
    const selection = window.getSelection();
    const startPoint = findPoint(start);
    const endPoint = findPoint(end);
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function mentionToken(mention: ChatEntityMention): string {
    return `@${mention.label}`;
  }

  function getSignature(value: string, valueMentions: readonly ChatEntityMention[]): string {
    return JSON.stringify([value, valueMentions.map((mention) => [
      mention.type,
      mention.id,
      mention.label,
      mention.occurrenceId,
      mention.start,
      mention.end,
    ])]);
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderHtml(nextSegments: Segment[]): string {
    return nextSegments.map((segment) => {
      if (segment.type === 'text') return escapeHtml(segment.value);
      const label = escapeHtml(segment.mention.label);
      const type = escapeHtml(segment.mention.type);
      const key = escapeHtml(segment.key);
      return `<button type="button" contenteditable="false" data-mention-occurrence="${key}" class="${MENTION_CARD_CLASS}" title="${label}" aria-label="Remove ${type} mention: ${label}">${type}</button>`;
    }).join('');
  }

  function getNodeMention(node: HTMLElement): ChatEntityMention | undefined {
    const key = node.dataset.mentionOccurrence;
    if (!key) return undefined;
    const segment = segments.find((candidate) => candidate.type === 'mention' && candidate.key === key);
    return segment?.type === 'mention' ? segment.mention : undefined;
  }

  function nodeLength(node: Node): number {
    if (node instanceof HTMLElement && node.dataset.mentionOccurrence) {
      const mention = getNodeMention(node);
      return mention ? mentionToken(mention).length : 0;
    }
    if (node instanceof HTMLBRElement) return 1;
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
    return [...node.childNodes].reduce((total, child) => total + nodeLength(child), 0);
  }

  function findPoint(target: number): { node: Node; offset: number } {
    if (!editor) return { node: document.body, offset: 0 };
    let traversed = 0;
    const children = [...editor.childNodes];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      const length = nodeLength(child);
      if (child.nodeType === Node.TEXT_NODE && target <= traversed + length) {
        return { node: child, offset: Math.max(0, target - traversed) };
      }
      if (target <= traversed + length) {
        return { node: editor, offset: target === traversed ? index : index + 1 };
      }
      traversed += length;
    }
    return { node: editor, offset: children.length };
  }

  function getCursorOffset(): number {
    if (!editor) return content.length;
    const selection = window.getSelection();
    if (!selection?.anchorNode || !editor.contains(selection.anchorNode)) return content.length;

    let offset = 0;
    const visit = (node: Node): boolean => {
      if (node === selection.anchorNode) {
        if (node.nodeType === Node.TEXT_NODE) {
          offset += selection.anchorOffset;
        } else {
          const children = [...node.childNodes].slice(0, selection.anchorOffset);
          offset += children.reduce((total, child) => total + nodeLength(child), 0);
        }
        return true;
      }
      if (node instanceof HTMLElement && node.dataset.mentionOccurrence) {
        offset += nodeLength(node);
        return false;
      }
      if (node instanceof HTMLBRElement) {
        offset += 1;
        return false;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        offset += node.textContent?.length ?? 0;
        return false;
      }
      for (const child of node.childNodes) {
        if (visit(child)) return true;
      }
      return false;
    };

    visit(editor);
    return offset;
  }

  function readEditor(): { content: string; mentions: ChatEntityMention[] } {
    if (!editor) return { content, mentions };
    let nextContent = '';
    const nextMentions: ChatEntityMention[] = [];

    const visit = (node: Node) => {
      if (node instanceof HTMLElement && node.dataset.mentionOccurrence) {
        const mention = getNodeMention(node);
        if (!mention) return;
        const token = mentionToken(mention);
        const start = nextContent.length;
        nextContent += token;
        nextMentions.push({ ...mention, start, end: start + token.length });
        return;
      }
      if (node instanceof HTMLBRElement) {
        nextContent += '\n';
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        nextContent += node.textContent ?? '';
        return;
      }
      for (const child of node.childNodes) visit(child);
    };

    for (const child of editor.childNodes) visit(child);
    if (nextMentions.length === 0 && nextContent === '\n') nextContent = '';
    return { content: nextContent, mentions: nextMentions };
  }

  function syncFromEditor() {
    if (composing) return;
    const cursor = getCursorOffset();
    const next = readEditor();
    lastEmittedSignature = getSignature(next.content, next.mentions);
    onchange(next.content, next.mentions, cursor);
  }

  function notifyCursor() {
    oncursor?.(getCursorOffset());
  }

  function handleClick(event: MouseEvent) {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-mention-occurrence]')
      : null;
    if (target && editor?.contains(target)) {
      const mention = getNodeMention(target);
      if (mention) {
        event.stopPropagation();
        onremove?.(mention);
        return;
      }
    }
    notifyCursor();
  }

  function insertTextAtSelection(value: string) {
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const text = document.createTextNode(value);
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    syncFromEditor();
  }

  function handleBeforeInput(event: InputEvent) {
    if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') return;
    event.preventDefault();
    insertTextAtSelection('\n');
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    insertTextAtSelection(event.clipboardData?.getData('text/plain') ?? '');
  }
</script>

<div
  bind:this={editor}
  bind:innerHTML={renderedHtml}
  class={`inline-mention-editor whitespace-pre-wrap break-words outline-none ${className}`}
  class:is-empty={!content && mentions.length === 0}
  contenteditable="true"
  inert={disabled}
  role="textbox"
  aria-multiline="true"
  aria-label={ariaLabel}
  aria-disabled={disabled}
  tabindex={disabled ? -1 : 0}
  data-placeholder={placeholder}
  spellcheck="true"
  oninput={syncFromEditor}
  onbeforeinput={handleBeforeInput}
  onpaste={handlePaste}
  oncompositionstart={() => composing = true}
  oncompositionend={() => { composing = false; syncFromEditor(); }}
  onkeyup={notifyCursor}
  onclick={handleClick}
  onkeydown={onkeydown}
></div>

<style>
  .inline-mention-editor {
    position: relative;
  }

  .inline-mention-editor.is-empty::before {
    box-sizing: border-box;
    color: var(--text-tertiary);
    content: attr(data-placeholder);
    inset: 0;
    padding: inherit;
    pointer-events: none;
    position: absolute;
  }
</style>
