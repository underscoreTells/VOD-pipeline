import type { LLMProviderType } from "../providers/index.js";
import type { AgentToolDefinition } from "./define-tool.js";
import {
  isToolInputValidationError,
  validateCanonicalSchema,
} from "./runtime.js";
import { getProviderToolStrategy } from "./registry.js";
import type { CompiledProviderTool } from "./strategies/base.js";

export interface ExecutableTool<TParsed = unknown> {
  name: string;
  execute(input: unknown): Promise<string>;
  definition: AgentToolDefinition<TParsed>;
}

export interface ProviderBoundToolSet {
  provider: LLMProviderType;
  compiledTools: CompiledProviderTool[];
  bindPayload: unknown[];
  executableToolMap: Map<string, ExecutableTool>;
}

export function bindAgentToolsForProvider(
  provider: LLMProviderType,
  tools: AgentToolDefinition[]
): ProviderBoundToolSet {
  const strategy = getProviderToolStrategy(provider);
  const compiledTools = tools.map((tool) => strategy.compileTool(tool));
  const executableToolMap = new Map(
    tools.map((tool) => [tool.name, createExecutableTool(tool)])
  );

  return {
    provider,
    compiledTools,
    bindPayload: strategy.buildBindPayload(compiledTools),
    executableToolMap,
  };
}

export function isExecutableToolValidationError(error: unknown): boolean {
  return isToolInputValidationError(error);
}

function createExecutableTool<TParsed>(
  tool: AgentToolDefinition<TParsed>
): ExecutableTool<TParsed> {
  return {
    name: tool.name,
    definition: tool,
    async execute(input: unknown): Promise<string> {
      const parsed = validateCanonicalSchema<TParsed>(tool.schema, input, tool.parse);
      const result = await tool.execute(parsed);
      return typeof result === "string" ? result : JSON.stringify(result);
    },
  };
}
