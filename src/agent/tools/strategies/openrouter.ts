import { OpenAIToolStrategy } from "./openai.js";

export class OpenRouterToolStrategy extends OpenAIToolStrategy {
  readonly provider = "openrouter" as const;
}
