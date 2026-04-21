import { OpenAIToolStrategy } from "./openai.js";

export class KimiToolStrategy extends OpenAIToolStrategy<"kimi"> {
  constructor() {
    super("kimi");
  }
}
