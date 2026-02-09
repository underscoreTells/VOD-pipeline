import { describe, it, expect } from 'vitest';
import type { Chapter } from '../../src/shared/types/database.js';
import {
  clampToChapter,
  getChapterDuration,
  toChapterGlobalTime,
  toChapterLocalTime,
} from '../../src/renderer/lib/utils/chapter-time.js';

const baseChapter = {
  id: 1,
  project_id: 1,
  title: 'Test Chapter',
  start_time: 10,
  end_time: 30,
  display_order: 0,
  created_at: new Date().toISOString(),
} as Chapter;

describe('chapter-time utils', () => {
  it('returns duration based on start/end', () => {
    expect(getChapterDuration(baseChapter)).toBe(20);
  });

  it('clamps time into chapter bounds', () => {
    expect(clampToChapter(baseChapter, 5)).toBe(10);
    expect(clampToChapter(baseChapter, 25)).toBe(25);
    expect(clampToChapter(baseChapter, 40)).toBe(30);
  });

  it('maps global time to local time', () => {
    expect(toChapterLocalTime(baseChapter, 10)).toBe(0);
    expect(toChapterLocalTime(baseChapter, 15)).toBe(5);
    expect(toChapterLocalTime(baseChapter, 35)).toBe(20);
  });

  it('maps local time to global time', () => {
    expect(toChapterGlobalTime(baseChapter, 0)).toBe(10);
    expect(toChapterGlobalTime(baseChapter, 5)).toBe(15);
    expect(toChapterGlobalTime(baseChapter, 30)).toBe(30);
  });
});
