import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProviderModels } from '../../src/electron/services/provider-model-service.js';

describe('provider model discovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('filters non-chat OpenAI models and merges curated capabilities', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'gpt-5.6-terra', object: 'model' },
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
});
