import type { AgentToolDefinition } from "../define-tool.js";
import {
  compileJsonSchemaLike,
  type AnthropicToolDefinition,
  type CompiledProviderTool,
  type ProviderToolStrategy,
} from "./base.js";

export class AnthropicToolStrategy implements ProviderToolStrategy<AnthropicToolDefinition> {
  readonly provider = "anthropic" as const;

  compileSchema(schema: AgentToolDefinition["schema"]) {
    return compileJsonSchemaLike(schema);
  }

  compileTool(tool: AgentToolDefinition): CompiledProviderTool<AnthropicToolDefinition> {
    const compiledSchema = this.compileSchema(tool.schema);
    return {
      provider: this.provider,
      name: tool.name,
      schema: compiledSchema,
      definition: {
        name: tool.name,
        description: tool.description,
        input_schema: compiledSchema,
        ...(Array.isArray(tool.examples) && tool.examples.length > 0
          ? { input_examples: tool.examples }
          : {}),
        ...(tool.metadata?.anthropicStrict ? { strict: true } : {}),
      },
    };
  }

  buildBindPayload(
    tools: CompiledProviderTool<AnthropicToolDefinition>[]
  ): AnthropicToolDefinition[] {
    return tools.map((tool) => tool.definition);
  }
}
