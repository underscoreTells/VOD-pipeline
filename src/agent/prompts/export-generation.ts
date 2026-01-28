import { ChatPromptTemplate } from "@langchain/core/prompts";
import { SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

export const exportGenerationPrompt = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(
    `Generate a JSON cut list for video editing.`
  ),
  HumanMessagePromptTemplate.fromTemplate(
    `All chapter beats and metadata:

{chapters_data}

Generate a cut list that preserves essential narrative moments.

Respond with JSON in this format:
{{
  "projectId": "...",
  "projectName": "...",
  "format": "vod-pipeline-cutlist-v1",
  "created": "ISO-8601 timestamp",
  "cuts": [
    {{
      "chapterId": "...",
      "chapterTitle": "...",
      "assetPath": "/absolute/path/to/original/video",
      "inTime": 123.456,
      "outTime": 456.789,
      "duration": 333.333,
      "label": "setup",
      "notes": "why_essential text",
      "beats": [
        {{
          "type": "setup",
          "timestamp": 123.456,
          "description": "..."
        }}
      ],
      "optionalSegments": [
        {{
          "start": 150.0,
          "end": 180.0,
          "reason": "repeated explanation"
        }}
      ]
    }}
  ]
}}`
  ),
]);
