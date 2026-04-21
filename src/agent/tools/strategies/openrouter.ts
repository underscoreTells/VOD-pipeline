import { OpenAIToolStrategy } from "./openai.js";

export class OpenRouterToolStrategy extends OpenAIToolStrategy<"openrouter"> {
  constructor() {
    super("openrouter");
  }
}
