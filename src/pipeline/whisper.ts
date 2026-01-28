import { spawn } from 'child_process';
import * as path from 'path';
import { getPythonPath, hasFasterWhisper } from '../electron/python-detector';
import type {
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionOptions,
  TranscriptionProgress,
  TranscriptionProgressCallback,
} from '../shared/types/pipeline';

export class WhisperError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'WhisperError';
  }
}

interface WhisperOutput {
  text: string;
  language: string;
  duration: number;
  segments: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Transcribe audio file using Whisper
 */
export async function transcribe(
  options: TranscriptionOptions,
  onProgress?: TranscriptionProgressCallback
): Promise<TranscriptionResult> {
  const pythonPath = getPythonPath();
  if (!pythonPath) {
    throw new WhisperError('Python not found', 'PYTHON_NOT_FOUND');
  }

  // Check if faster-whisper is available
  const hasWhisper = await hasFasterWhisper(pythonPath.path);
  if (!hasWhisper) {
    throw new WhisperError(
      'faster-whisper not installed. Run: pip install faster-whisper',
      'WHISPER_NOT_INSTALLED'
    );
  }

  // Find transcribe.py script
  const scriptPath = await findTranscribeScript();
  if (!scriptPath) {
    throw new WhisperError('transcribe.py script not found', 'SCRIPT_NOT_FOUND');
  }

  return new Promise((resolve, reject) => {
    const args: string[] = [
      scriptPath,
      '--audio', options.audioPath,
      '--model', options.model || 'base',
      '--output-format', 'json',
    ];

    if (options.language) {
      args.push('--language', options.language);
    }

    if (options.computeType) {
      args.push('--compute-type', options.computeType);
    }

    console.log(`[Whisper] Starting transcription: ${pythonPath.path} ${args.join(' ')}`);

    const proc = spawn(pythonPath.path, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Parse progress messages
      const progressMatch = chunk.match(/PROGRESS:(.+)/);
      if (progressMatch && onProgress) {
        try {
          const progress: TranscriptionProgress = JSON.parse(progressMatch[1]);
          onProgress(progress);
        } catch {
          // Ignore malformed progress messages
        }
      }
    });

    proc.on('error', (error) => {
      reject(new WhisperError(
        `Failed to run transcription: ${error.message}`,
        'PROCESS_ERROR',
        error
      ));
    });

    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new WhisperError(
          `Transcription failed with code ${code}: ${stderr}`,
          'TRANSCRIPTION_FAILED',
          { code, stderr }
        ));
        return;
      }

      try {
        const output: WhisperOutput = JSON.parse(stdout);
        const result: TranscriptionResult = {
          text: output.text,
          language: output.language,
          duration: output.duration,
          segments: output.segments.map(s => ({
            id: s.id,
            start: s.start,
            end: s.end,
            text: s.text.trim(),
          })),
        };
        resolve(result);
      } catch (error) {
        reject(new WhisperError(
          'Failed to parse transcription output',
          'PARSE_ERROR',
          { error, stdout }
        ));
      }
    });
  });
}

/**
 * Transcribe with automatic language detection
 */
export async function transcribeAutoDetect(
  audioPath: string,
  onProgress?: TranscriptionProgressCallback
): Promise<TranscriptionResult> {
  return transcribe(
    {
      audioPath,
      model: 'base',
    },
    onProgress
  );
}

/**
 * Find the transcribe.py script
 */
async function findTranscribeScript(): Promise<string | null> {
  const possiblePaths = [
    // Production path
    path.join(process.resourcesPath || '', 'python', 'transcribe.py'),
    // Development paths
    path.join(process.cwd(), 'python', 'transcribe.py'),
    path.join(process.cwd(), '..', 'python', 'transcribe.py'),
    path.join(__dirname, '..', '..', 'python', 'transcribe.py'),
  ];

  for (const testPath of possiblePaths) {
    try {
      const fs = await import('fs');
      if (fs.existsSync(testPath)) {
        return testPath;
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

/**
 * Check if transcription is available (Python + faster-whisper)
 */
export async function isTranscriptionAvailable(): Promise<boolean> {
  const pythonPath = getPythonPath();
  if (!pythonPath) return false;

  return hasFasterWhisper(pythonPath.path);
}

/**
 * Get available Whisper models
 */
export function getAvailableModels(): Array<{ name: string; description: string }> {
  return [
    { name: 'tiny', description: 'Fastest, lowest accuracy (39 MB)' },
    { name: 'base', description: 'Fast with good accuracy (74 MB) - Default' },
    { name: 'small', description: 'Balanced speed/accuracy (244 MB)' },
    { name: 'medium', description: 'Slower, high accuracy (769 MB)' },
  ];
}

/**
 * Get available compute types
 */
export function getAvailableComputeTypes(): Array<{ name: string; description: string }> {
  return [
    { name: 'int8', description: 'Fast, lower memory - Default' },
    { name: 'float16', description: 'Higher accuracy, requires more memory' },
  ];
}
