import type { CanonicalSchemaNode } from "./schema.js";

export interface AgentToolMetadata {
  anthropicStrict?: boolean;
}

export interface AgentToolDefinition<TParsed = unknown> {
  name: string;
  description: string;
  schema: CanonicalSchemaNode;
  examples?: unknown[];
  parse?: (validated: unknown) => TParsed;
  execute: (input: TParsed) => Promise<string> | string;
  metadata?: AgentToolMetadata;
}

export function defineAgentTool<TParsed>(
  definition: AgentToolDefinition<TParsed>
): AgentToolDefinition<TParsed> {
  return definition;
}
