import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeGeminiVideoAnalysis } from '../../src/agent/utils/video-messages.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Gemini video analysis request', () => {
  it('sends explicit sampling and targeted offsets without exposing them only in prose', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pipeline-gemini-video-'));
    const videoPath = path.join(tempDir, 'proxy.mp4');
    fs.writeFileSync(videoPath, Buffer.from('small-video-fixture'));
    let requestBody: Record<string, unknown> | null = null;

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"summary":"Observed","observations":[]}' }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    try {
      await expect(invokeGeminiVideoAnalysis({
        apiKey: 'test-key',
        model: 'gemini-test',
        videoPath,
        textPrompt: 'Inspect this range',
        startOffsetSeconds: 12.5,
        endOffsetSeconds: 24,
        fps: 2,
      })).resolves.toContain('Observed');

      const contents = requestBody?.contents as Array<{
        parts: Array<{ videoMetadata?: Record<string, unknown> }>;
      }>;
      expect(contents[0]?.parts[0]?.videoMetadata).toEqual({
        fps: 2,
        startOffset: '12.500s',
        endOffset: '24.000s',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
