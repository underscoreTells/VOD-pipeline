import type { CanonicalSchemaNode } from "./schema.js";

export interface AgentToolDefinition<TParsed = any> {
  name: string;
  description: string;
  schema: CanonicalSchemaNode;
  parse?: (validated: unknown) => TParsed;
  execute: (input: TParsed, options?: { signal?: AbortSignal }) => Promise<string> | string;
}

export function defineAgentTool<TParsed>(
  definition: AgentToolDefinition<TParsed>
): AgentToolDefinition<TParsed> {
  return definition;
}
