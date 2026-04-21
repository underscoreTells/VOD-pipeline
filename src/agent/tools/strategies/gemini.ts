import type { AgentToolDefinition } from "../define-tool.js";
import {
  compileGeminiSchema,
  type CompiledProviderTool,
  type GeminiFunctionDeclaration,
  type GeminiToolDefinition,
  type ProviderToolStrategy,
} from "./base.js";

export class GeminiToolStrategy implements ProviderToolStrategy<GeminiFunctionDeclaration> {
  readonly provider = "gemini" as const;

  compileSchema(schema: AgentToolDefinition["schema"]) {
    return compileGeminiSchema(schema);
  }

  compileTool(tool: AgentToolDefinition): CompiledProviderTool<GeminiFunctionDeclaration> {
    const compiledSchema = this.compileSchema(tool.schema);
    return {
      provider: this.provider,
      name: tool.name,
      schema: compiledSchema,
      definition: {
        name: tool.name,
        description: tool.description,
        parameters: compiledSchema,
      },
    };
  }

  buildBindPayload(
    tools: CompiledProviderTool<GeminiFunctionDeclaration>[]
  ): GeminiToolDefinition[] {
    if (tools.length === 0) {
      return [];
    }

    return [
      {
        functionDeclarations: tools.map((tool) => tool.definition),
      },
    ];
  }
}
