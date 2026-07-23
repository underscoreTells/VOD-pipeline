import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProviderModels } from '../../src/electron/services/provider-model-service.js';

describe('provider model discovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('filters non-chat OpenAI models and merges curated capabilities', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'gpt-5.6-terra', object: 'model' },
        { id: 'gpt-6-preview', object: 'model' },
        { id: 'text-embedding-4', object: 'model' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await listProviderModels('openai', {
      providers: { openai: 'sk-test' },
    }, true);

    expect(models).toEqual([
      expect.objectContaining({
        id: 'gpt-5.6-terra',
        contextTokenLimit: 1_048_576,
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        source: 'live',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://api.openai.com/v1/models' }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }) })
    );
  });

  it('does not infer video support for uncurated live models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [
        {
          name: 'models/gemini-3.6-flash-001',
          displayName: 'Gemini 3.6 Flash 001',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          name: 'models/gemini-experimental',
          displayName: 'Gemini Experimental',
          supportedGenerationMethods: ['generateContent'],
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const models = await listProviderModels('gemini', {
      providers: { gemini: 'AIza-test' },
    }, true);

    expect(models).toEqual([
      expect.objectContaining({
        id: 'gemini-3.6-flash-001',
        supportsVideo: true,
        compatibility: 'supported',
      }),
      expect.objectContaining({
        id: 'gemini-experimental',
        supportsVideo: false,
        compatibility: 'unknown',
      }),
    ]);
  });
});
