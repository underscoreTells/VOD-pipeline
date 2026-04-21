import type { LLMProviderType } from "../../providers/index.js";
import type { AgentToolDefinition } from "../define-tool.js";
import {
  compileJsonSchemaLike,
  type CompiledProviderTool,
  type OpenAIFunctionToolDefinition,
  type ProviderToolStrategy,
} from "./base.js";

export class OpenAIToolStrategy<
  TProvider extends Extract<LLMProviderType, "openai" | "openrouter" | "kimi"> = "openai",
> implements ProviderToolStrategy<OpenAIFunctionToolDefinition> {
  readonly provider: TProvider;

  constructor(provider: TProvider = "openai" as TProvider) {
    this.provider = provider;
  }

  compileSchema(schema: AgentToolDefinition["schema"]) {
    return compileJsonSchemaLike(schema);
  }

  compileTool(tool: AgentToolDefinition): CompiledProviderTool<OpenAIFunctionToolDefinition> {
    const compiledSchema = this.compileSchema(tool.schema);
    return {
      provider: this.provider,
      name: tool.name,
      schema: compiledSchema,
      definition: {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: compiledSchema,
        },
      },
    };
  }

  buildBindPayload(
    tools: CompiledProviderTool<OpenAIFunctionToolDefinition>[]
  ): OpenAIFunctionToolDefinition[] {
    return tools.map((tool) => tool.definition);
  }
}
