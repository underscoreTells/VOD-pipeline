import { ChatPromptTemplate } from "@langchain/core/prompts";
import { SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

export const storyCohesionPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(
    `Analyze story cohesion across all chapters.`
  ),
  HumanMessagePromptTemplate.fromTemplate(
    `All chapters with summaries and beats:

{chapters_data}

Identify:
1. Themes - Recurring ideas, motifs, or messages across chapters
2. Callbacks - References to earlier content that pay off later (setup → payoff connections)
3. Through-lines - Storylines that span multiple chapters
4. Recommendations - Chapter reordering suggestions and pacing improvements

Respond with JSON:
{{
  "themes": ["theme 1", "theme 2", ...],
  "callbacks": [
    {{
      "setup_chapter": "chapter_id",
      "setup_timestamp": 123.45,
      "payoff_chapter": "chapter_id",
      "payoff_timestamp": 456.78,
      "description": "..."
    }}
  ],
  "through_lines": [
    {{
      "name": "throughline name",
      "chapters": ["chapter_1", "chapter_2", ...],
      "description": "..."
    }}
  ],
  "recommendations": "Analysis of chapter order, pacing, and overall storytelling",
  "suggested_order": ["chapter_id_1", "chapter_id_2", ...]
}}`
  ),
]);
