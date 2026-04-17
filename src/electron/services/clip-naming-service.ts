import { getChapter, getTranscriptsByChapter } from '../database/index.js';

function sanitizeSuggestedClipName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/^"+|"+$/g, '')
    .trim();

  if (normalized.length < 3) {
    return null;
  }

  return normalized.slice(0, 80);
}

function extractOpenAITextPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const outputText = sanitizeSuggestedClipName(record.output_text);
  if (outputText) {
    return outputText;
  }

  const output = record.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== 'object') {
          continue;
        }

        const text = sanitizeSuggestedClipName((contentItem as Record<string, unknown>).text);
        if (text) {
          return text;
        }
      }
    }
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (first && typeof first === 'object') {
      const message = (first as Record<string, unknown>).message;
      if (message && typeof message === 'object') {
        const content = sanitizeSuggestedClipName((message as Record<string, unknown>).content);
        if (content) {
          return content;
        }
      }
    }
  }

  return null;
}

function buildTranscriptExcerpt(
  transcripts: Array<{ text: string; start_time: number; end_time: number }>,
  inPoint: number,
  outPoint: number
): string {
  const overlapEpsilon = 0.001;
  const snippets: string[] = [];

  for (const transcript of transcripts) {
    if (!transcript || typeof transcript.text !== 'string') {
      continue;
    }

    const start = transcript.start_time;
    const end = transcript.end_time;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    if (end <= inPoint + overlapEpsilon || start >= outPoint - overlapEpsilon) {
      continue;
    }

    const text = transcript.text.trim();
    if (!text) {
      continue;
    }

    snippets.push(text);
    if (snippets.join(' ').length > 1200) {
      break;
    }
  }

  return snippets.join(' ').slice(0, 1200);
}

async function requestOpenAIClipName(input: {
  apiKey: string;
  model: string;
  chapterTitle: string;
  inPoint: number;
  outPoint: number;
  transcriptExcerpt: string;
}): Promise<string | null> {
  const { apiKey, model, chapterTitle, inPoint, outPoint, transcriptExcerpt } = input;

  if (typeof fetch !== 'function') {
    throw new Error('Fetch API is not available in main process');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_output_tokens: 24,
      input: [
        {
          role: 'system',
          content:
            'You name short video clips for editors. Return only one concise 3-7 word title. No quotes, no trailing punctuation, no labels.',
        },
        {
          role: 'user',
          content: [
            `Chapter title: ${chapterTitle || 'Untitled chapter'}`,
            `Clip local time range: ${inPoint.toFixed(2)}s to ${outPoint.toFixed(2)}s`,
            transcriptExcerpt ? `Transcript excerpt: ${transcriptExcerpt}` : 'Transcript excerpt: (none)',
            'Return title only.',
          ].join('\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${message.slice(0, 200)}`);
  }

  const payload = await response.json();
  return extractOpenAITextPayload(payload);
}

export async function suggestChapterClipName(input: {
  chapterId: number;
  inPoint: number;
  outPoint: number;
  model: string;
  apiKey: string;
  chapterTitle?: string;
}): Promise<string | null> {
  const chapter = await getChapter(input.chapterId);
  if (!chapter) {
    throw new Error('Chapter not found');
  }

  const transcriptRows = await getTranscriptsByChapter(input.chapterId);
  const transcriptExcerpt = buildTranscriptExcerpt(transcriptRows, input.inPoint, input.outPoint);
  const chapterTitle = input.chapterTitle?.trim() || chapter.title;

  try {
    const name = await requestOpenAIClipName({
      apiKey: input.apiKey,
      model: input.model,
      chapterTitle,
      inPoint: input.inPoint,
      outPoint: input.outPoint,
      transcriptExcerpt,
    });

    return sanitizeSuggestedClipName(name);
  } catch (primaryError) {
    if (input.model === 'gpt-4o-mini') {
      throw primaryError;
    }

    const fallbackName = await requestOpenAIClipName({
      apiKey: input.apiKey,
      model: 'gpt-4o-mini',
      chapterTitle,
      inPoint: input.inPoint,
      outPoint: input.outPoint,
      transcriptExcerpt,
    });

    return sanitizeSuggestedClipName(fallbackName);
  }
}
