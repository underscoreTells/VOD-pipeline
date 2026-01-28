import { ChatPromptTemplate } from "@langchain/core/prompts";
import { SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

export const narrativeAnalysisPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(
    `Analyze this video chapter transcript for narrative structure.`
  ),
  HumanMessagePromptTemplate.fromTemplate(
    `Transcript:
{transcript}

Identify the following:
1. Chapter title - A brief, descriptive title
2. Logline - One-sentence summary of this chapter
3. Story beats - Key narrative moments with timestamps (setup, escalation, twist, payoff, transition)
4. Optional cuts - Repetitive or unnecessary sections that can be removed with reasons
5. Cold open candidate - Whether this chapter could work as a cold open (true/false)

Respond with JSON in this format:
{{
  "chapter_title": "...",
  "logline": "...",
  "beats": [
    {{
      "type": "setup|escalation|twist|payoff|transition",
      "timestamp": 123.45,
      "description": "..."
    }}
  ],
  "optional_cuts": [
    {{
      "start": 150.0,
      "end": 180.0,
      "reason": "repeated explanation"
    }}
  ],
  "cold_open_candidate": true|false
}}`
  ),
]);
