import { ChatPromptTemplate } from "@langchain/core/prompts";
import { SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

export const beatExtractionPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(
    `Extract narrative beats from this chapter.`
  ),
  HumanMessagePromptTemplate.fromTemplate(
    `Chapter summary:
{summary}

Full transcript:
{transcript}

Extract essential vs optional moments:

Beat types to identify:
- setup: Establishes the premise, characters, or stakes
- escalation: Raises tension, adds complexity
- twist: Changes direction or reveals new information
- payoff: Delivers on established setup or tension
- transition: Moves between scenes or topics

For each beat:
1. Mark as essential (true) or optional (false)
2. Include timestamps for in/out points
3. Identify visual dependency (none, important, critical) - which beats need visual verification

Respond with JSON:
{{
  "beats": [
    {{
      "type": "setup|escalation|twist|payoff|transition",
      "start_time": 123.45,
      "end_time": 234.56,
      "description": "...",
      "essential": true|false,
      "why_essential": "...",
      "visual_dependency": "none|important|critical"
    }}
  ]
}}`
  ),
]);
