import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChapterDefinition from '../../src/renderer/lib/components/ChapterDefinition.svelte';
import { clearVodCut } from '../../src/renderer/lib/state/vod-cut.svelte.js';

vi.mock('../../src/renderer/lib/components/vod-cut/VodCutTimeline.svelte', async () => {
  const component = await import('../support/StubComponent.svelte');
  return { default: component.default };
});

describe('VOD cutting workspace', () => {
  beforeEach(() => clearVodCut());

  it('renders the focused cutter actions and retained-range guidance', () => {
    const { body } = render(ChapterDefinition, {
      props: {
        asset: {
          id: 2,
          project_id: 1,
          file_path: '/tmp/stream.mp4',
          file_type: 'video',
          duration: 7200,
          metadata: { fps: 60 },
          created_at: '2026-07-18T00:00:00.000Z',
        },
        projectId: 1,
        onComplete: vi.fn(),
        onCancel: vi.fn(),
        onDiscard: vi.fn(),
      },
    });

    expect(body).toContain('Cut VOD into chapters');
    expect(body).toContain('Save &amp; exit');
    expect(body).toContain('Create 0 chapters');
    expect(body).toContain('Gaps are omitted from the finished project');
    expect(body).toContain('Mark In');
    expect(body).toContain('Mark Out');
  });
});
