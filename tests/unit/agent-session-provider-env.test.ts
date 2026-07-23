import { afterEach, describe, expect, it } from 'vitest';
import {
  agentState,
  buildProviderEnvFromSettings,
} from '../../src/renderer/lib/state/agent-session.svelte.js';
import { modelCatalogState } from '../../src/renderer/lib/state/model-catalog.svelte.js';

const originalProvider = agentState.selectedProvider;
const originalModel = agentState.selectedModel;
const originalCatalog = { ...modelCatalogState.models };

afterEach(() => {
  agentState.selectedProvider = originalProvider;
  agentState.selectedModel = originalModel;
  modelCatalogState.models = { ...originalCatalog };
});

describe('agent session provider environment', () => {
  it('uses the context limit returned by live model discovery', () => {
    agentState.selectedProvider = 'openrouter';
    agentState.selectedModel = 'vendor/small-context-model';
    modelCatalogState.models.openrouter = [{
      id: agentState.selectedModel,
      label: 'Small Context Model',
      contextTokenLimit: 32_768,
      supportsVideo: false,
      reasoningEfforts: [],
      source: 'live',
      compatibility: 'unknown',
    }];

    const config = buildProviderEnvFromSettings();

    expect(config.contextTokenLimits?.openrouter).toBe(32_768);
  });

  it('retains video support for a persisted curated model version', () => {
    agentState.selectedProvider = 'gemini';
    agentState.selectedModel = 'gemini-3.6-flash-001';
    delete modelCatalogState.models.gemini;

    const config = buildProviderEnvFromSettings();

    expect(config.modelSupportsVideo?.gemini).toBe(true);
  });
});
