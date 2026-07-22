import { describe, expect, it } from 'vitest';
import {
  normalizeClipContextDetails,
  normalizeReferencedEntities,
} from '../../src/agent/conversation/input-normalization.js';

describe('conversation input normalization', () => {
  it('preserves validated clip context details', () => {
    expect(normalizeClipContextDetails({
      visibleDuration: 8,
      transcriptExcerpt: 'A grounded excerpt',
      previousClipId: null,
      nextClipId: 12,
      omittedBeforeDuration: 3,
      omittedAfterDuration: 5,
    })).toEqual({
      visibleDuration: 8,
      transcriptExcerpt: 'A grounded excerpt',
      previousClipId: null,
      nextClipId: 12,
      omittedBeforeDuration: 3,
      omittedAfterDuration: 5,
    });
  });

  it('keeps valid entity mentions and drops malformed entries', () => {
    expect(normalizeReferencedEntities([
      { type: 'clip', id: 41, label: 'Setup clip' },
      { type: 'suggestion', id: 8, label: 'Trim pause' },
      { type: 'asset', id: 2, label: 'Wrong type' },
      { type: 'clip', id: '41', label: 'Wrong ID' },
    ])).toEqual([
      { type: 'clip', id: 41, label: 'Setup clip' },
      { type: 'suggestion', id: 8, label: 'Trim pause' },
    ]);
  });
});
