import { OpenAIToolStrategy } from "./openai.js";

export class KimiToolStrategy extends OpenAIToolStrategy {
  readonly provider = "kimi" as const;
}
