import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import ChapterDefinition from '../../src/renderer/lib/components/ChapterDefinition.svelte';

describe('ChapterDefinition', () => {
  it('renders the master VOD timeline flow and removes the old mark-in workflow', () => {
    const { body } = render(ChapterDefinition, {
      props: {
        asset: {
          id: 7,
          project_id: 3,
          file_path: '/vods/mario-odyssey-part-1.mp4',
          file_type: 'video',
          duration: 5400,
          metadata: null,
          created_at: '2026-05-03T00:00:00.000Z',
          availability: { exists: true },
        },
        projectId: 3,
        onComplete: () => {},
        onCancel: () => {},
      },
    });

    expect(body).toContain('Master VOD timeline');
    expect(body).toContain('Build every chapter on one master VOD timeline');
    expect(body).toContain('Preview chapter');
    expect(body).toContain('Create 0 chapters');
    expect(body).not.toContain('Mark Start');
    expect(body).not.toContain('Mark End');
    expect(body).not.toContain('Add Chapter');
    expect(body).not.toContain('Defined Chapters');
  });
});
