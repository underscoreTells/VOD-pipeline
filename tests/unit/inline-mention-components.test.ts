import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import InlineMentionContent from '../../src/renderer/lib/components/InlineMentionContent.svelte';
import InlineMentionEditor from '../../src/renderer/lib/components/InlineMentionEditor.svelte';

const mention = {
  type: 'clip' as const,
  id: 7,
  label: 'Payoff',
  occurrenceId: 'payoff-one',
  start: 5,
  end: 12,
};

describe('inline mention components', () => {
  it('renders positioned mentions as cards within sent message text', () => {
    const { body } = render(InlineMentionContent, {
      props: { content: 'Trim @Payoff now', mentions: [mention] },
    });

    expect(body).toContain('Trim ');
    expect(body).toContain('title="Payoff"');
    expect(body).toContain('>clip</button>');
    expect(body).toContain(' now');
  });

  it('renders the composer as an accessible rich-text editor', () => {
    const { body } = render(InlineMentionEditor, {
      props: {
        content: 'Trim @Payoff now',
        mentions: [mention],
        onchange: () => {},
      },
    });

    expect(body).toContain('contenteditable="true"');
    expect(body).toContain('role="textbox"');
    expect(body).toContain('aria-label="Message"');
  });
});
