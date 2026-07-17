import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getPythonPath,
  detectPython,
  clearPythonCache,
  hasFasterWhisper,
  hasPip,
  ensurePip,
  pipInstall,
  createVirtualEnv,
  type PythonPathResult,
} from '../electron/pythonDetector.js';
import type {
  TranscriptionResult,
  TranscriptionOptions,
  TranscriptionProgress,
  TranscriptionProgressCallback,
} from '../shared/types/pipeline.js';

// Define __dirname for ESM modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANAGED_PYTHON_ENV_DIRNAME = 'python-runtime';
const MANAGED_PYTHON_VENV_DIRNAME = 'venv';
const FASTER_WHISPER_PACKAGE_SPEC = 'faster-whisper';
const PIP_UPGRADE_SPEC = 'pip';

let whisperRuntimeSetupPromise: Promise<PythonPathResult> | null = null;

export interface WhisperRuntimeStatus {
  available: boolean;
  pythonPath?: string;
  pythonSource?: PythonPathResult['source'];
  pythonVersion?: string;
  hasPip: boolean;
  hasFasterWhisper: boolean;
  managedEnvPath?: string;
  error?: string;
}

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
    words?: Array<{
      word: string;
      start: number;
      end: number;
      probability?: number;
    }>;
  }>;
}

interface ManagedPythonPaths {
  runtimeDir: string;
  venvDir: string;
  pythonPath: string;
}

type WhisperDevice = 'auto' | 'cpu' | 'cuda';

interface WhisperProcessRunOptions {
  pythonExecutable: string;
  scriptPath: string;
  transcriptionOptions: TranscriptionOptions;
  onProgress?: TranscriptionProgressCallback;
  device: WhisperDevice;
  computeTypeOverride?: TranscriptionOptions['computeType'];
  signal?: AbortSignal;
}

function mapWhisperOutput(output: WhisperOutput): TranscriptionResult {
  return {
    text: output.text,
    language: output.language,
    duration: output.duration,
    segments: output.segments.map((segment) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text.trim(),
      words: Array.isArray(segment.words)
        ? segment.words
            .filter((word) =>
              word &&
              typeof word.word === 'string' &&
              typeof word.start === 'number' &&
              Number.isFinite(word.start) &&
              typeof word.end === 'number' &&
              Number.isFinite(word.end)
            )
            .map((word) => ({
              word: word.word,
              start: word.start,
              end: word.end,
              probability:
                typeof word.probability === 'number' && Number.isFinite(word.probability)
                  ? word.probability
                  : undefined,
            }))
        : undefined,
    })),
  };
}

function buildWhisperArgs(
  scriptPath: string,
  options: TranscriptionOptions,
  device: WhisperDevice,
  computeTypeOverride?: TranscriptionOptions['computeType']
): string[] {
  const args: string[] = [
    scriptPath,
    '--audio', options.audioPath,
    '--model', options.model || 'base',
    '--output-format', 'json',
    '--device', device,
  ];

  if (options.language) {
    args.push('--language', options.language);
  }

  const computeType = computeTypeOverride || options.computeType;
  if (computeType) {
    args.push('--compute-type', computeType);
  }

  if (options.wordTimestamps) {
    args.push('--word-timestamps');
  }

  return args;
}

function isLikelyCudaRuntimeFailureText(value: string): boolean {
  const text = value.toLowerCase();
  const referencesCuda =
    text.includes('cuda') ||
    text.includes('libcublas') ||
    text.includes('cublas') ||
    text.includes('cudnn') ||
    text.includes('libcuda');

  if (!referencesCuda) {
    return false;
  }

  return (
    text.includes('not found') ||
    text.includes('cannot be loaded') ||
    text.includes('failed to load') ||
    text.includes('runtime error') ||
    text.includes('unavailable') ||
    text.includes('no cuda-capable device')
  );
}

function shouldRetryOnCpu(error: unknown): boolean {
  if (!(error instanceof WhisperError)) {
    return false;
  }

  if (error.code !== 'TRANSCRIPTION_FAILED' && error.code !== 'PROCESS_ERROR') {
    return false;
  }

  const details = error.details;
  if (details && typeof details === 'object' && 'stderr' in details) {
    const stderr = (details as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && isLikelyCudaRuntimeFailureText(stderr)) {
      return true;
    }
  }

  return isLikelyCudaRuntimeFailureText(error.message);
}

function getWhisperFallbackReason(error: unknown): string {
  let reason = error instanceof Error ? error.message : String(error);
  if (error instanceof WhisperError) {
    const details = error.details;
    if (details && typeof details === 'object' && 'stderr' in details) {
      const stderr = (details as { stderr?: unknown }).stderr;
      if (typeof stderr === 'string' && stderr.trim()) {
        reason = stderr;
      }
    }
  }

  const excerpt = reason.replace(/\s+/g, ' ').trim() || 'unknown CUDA runtime error';
  const maxLength = 500;
  return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength - 3)}...` : excerpt;
}

async function runWhisperProcess(options: WhisperProcessRunOptions): Promise<TranscriptionResult> {
  const {
    pythonExecutable,
    scriptPath,
    transcriptionOptions,
    onProgress,
    device,
    computeTypeOverride,
    signal,
  } = options;

  const args = buildWhisperArgs(scriptPath, transcriptionOptions, device, computeTypeOverride);
  const effectiveComputeType = computeTypeOverride || transcriptionOptions.computeType || 'int8';

  if (signal?.aborted) {
    throw new WhisperError('Transcription cancelled before start', 'cancelled', { reason: 'aborted' });
  }

  return new Promise((resolve, reject) => {
    console.log(
      `[Whisper] Starting transcription: ${pythonExecutable} ${args.join(' ')} (device=${device}, compute=${effectiveComputeType})`
    );

    const proc = spawn(pythonExecutable, args);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may have already exited.
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new WhisperError('Transcription cancelled', 'cancelled', { reason: 'aborted' }));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      if (!onProgress) {
        return;
      }

      const progressRegex = /PROGRESS:({.+?})(?:\r?\n|$)/g;
      let match: RegExpExecArray | null = null;
      while ((match = progressRegex.exec(chunk)) !== null) {
        try {
          const progress: TranscriptionProgress = JSON.parse(match[1]);
          onProgress(progress);
        } catch {
          // Ignore malformed progress payloads.
        }
      }
    });

    proc.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new WhisperError(
        `Failed to run transcription: ${error.message}`,
        'PROCESS_ERROR',
        { error, device, computeType: effectiveComputeType }
      ));
    });

    proc.on('close', (code) => {
      if (settled) {
        return;
      }
      if (code !== 0) {
        settled = true;
        cleanup();
        reject(new WhisperError(
          `Transcription failed with code ${code}: ${stderr}`,
          'TRANSCRIPTION_FAILED',
          {
            code,
            stderr,
            stdout,
            device,
            computeType: effectiveComputeType,
          }
        ));
        return;
      }

      try {
        const output: WhisperOutput = JSON.parse(stdout);
        settled = true;
        cleanup();
        resolve(mapWhisperOutput(output));
      } catch (error) {
        settled = true;
        cleanup();
        reject(new WhisperError(
          'Failed to parse transcription output',
          'PARSE_ERROR',
          { error, stdout, stderr, device, computeType: effectiveComputeType }
        ));
      }
    });
  });
}

async function getManagedPythonPaths(): Promise<ManagedPythonPaths> {
  let userDataPath: string;

  try {
    const { app } = await import('electron');
    userDataPath = app.getPath('userData');
  } catch {
    userDataPath = path.join(process.cwd(), '.vod-pipeline-runtime');
  }

  const runtimeDir = path.join(userDataPath, MANAGED_PYTHON_ENV_DIRNAME);
  const venvDir = path.join(runtimeDir, MANAGED_PYTHON_VENV_DIRNAME);
  const pythonPath = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  return { runtimeDir, venvDir, pythonPath };
}

async function resolvePythonRuntime(): Promise<PythonPathResult | null> {
  const cached = getPythonPath();
  if (cached) return cached;
  return detectPython();
}

async function installWhisperIntoPython(pythonPath: string): Promise<void> {
  await ensurePip(pythonPath);
  await pipInstall(pythonPath, ['install', '--upgrade', PIP_UPGRADE_SPEC]);
  await pipInstall(pythonPath, ['install', FASTER_WHISPER_PACKAGE_SPEC]);

  const installed = await hasFasterWhisper(pythonPath);
  if (!installed) {
    throw new Error(`faster-whisper installation did not complete for ${pythonPath}`);
  }
}

async function setupManagedWhisperRuntime(basePython: PythonPathResult): Promise<PythonPathResult> {
  const managed = await getManagedPythonPaths();

  if (!fs.existsSync(managed.pythonPath)) {
    fs.mkdirSync(managed.runtimeDir, { recursive: true });
    await createVirtualEnv(basePython.path, managed.venvDir);
  }

  await installWhisperIntoPython(managed.pythonPath);

  clearPythonCache();
  const detected = await detectPython();
  if (detected?.source === 'managed') {
    return detected;
  }

  return {
    path: managed.pythonPath,
    source: 'managed',
    version: basePython.version,
  };
}

async function ensureWhisperRuntimeInstalled(): Promise<PythonPathResult> {
  const initialPython = await resolvePythonRuntime();
  if (!initialPython) {
    throw new WhisperError('Python not found', 'PYTHON_NOT_FOUND');
  }

  if (await hasFasterWhisper(initialPython.path)) {
    return initialPython;
  }

  const ensureTask = whisperRuntimeSetupPromise ?? (async () => {
    try {
      if (initialPython.source === 'managed') {
        await installWhisperIntoPython(initialPython.path);
        clearPythonCache();
        const refreshed = await detectPython();
        return refreshed ?? initialPython;
      }

      return await setupManagedWhisperRuntime(initialPython);
    } finally {
      whisperRuntimeSetupPromise = null;
    }
  })();

  whisperRuntimeSetupPromise = ensureTask;
  return ensureTask;
}

export async function getWhisperRuntimeStatus(
  options: { autoSetup?: boolean } = {}
): Promise<WhisperRuntimeStatus> {
  const autoSetup = options.autoSetup ?? false;
  const managedPaths = await getManagedPythonPaths();

  try {
    let python = await resolvePythonRuntime();
    if (!python) {
      return {
        available: false,
        hasPip: false,
        hasFasterWhisper: false,
        managedEnvPath: managedPaths.venvDir,
        error: 'Python not found',
      };
    }

    if (autoSetup && !(await hasFasterWhisper(python.path))) {
      python = await ensureWhisperRuntimeInstalled();
    }

    const [pipAvailable, whisperAvailable] = await Promise.all([
      hasPip(python.path),
      hasFasterWhisper(python.path),
    ]);

    return {
      available: pipAvailable && whisperAvailable,
      pythonPath: python.path,
      pythonSource: python.source,
      pythonVersion: python.version,
      hasPip: pipAvailable,
      hasFasterWhisper: whisperAvailable,
      managedEnvPath: managedPaths.venvDir,
      error: pipAvailable && whisperAvailable ? undefined : 'Whisper dependencies are missing',
    };
  } catch (error) {
    return {
      available: false,
      hasPip: false,
      hasFasterWhisper: false,
      managedEnvPath: managedPaths.venvDir,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Transcribe audio file using Whisper
 */
export async function transcribe(
  options: TranscriptionOptions,
  onProgress?: TranscriptionProgressCallback,
  signal?: AbortSignal
): Promise<TranscriptionResult> {
  if (signal?.aborted) {
    throw new WhisperError('Transcription cancelled before start', 'cancelled', { reason: 'aborted' });
  }

  const pythonRuntime = await resolvePythonRuntime();
  if (!pythonRuntime) {
    throw new WhisperError('Python not found', 'PYTHON_NOT_FOUND');
  }

  let pythonExecutable = pythonRuntime.path;

  // Ensure faster-whisper runtime exists (auto-bootstraps managed venv when missing)
  const hasWhisper = await hasFasterWhisper(pythonExecutable);
  if (!hasWhisper) {
    try {
      const preparedRuntime = await ensureWhisperRuntimeInstalled();
      pythonExecutable = preparedRuntime.path;
    } catch (error) {
      const status = await getWhisperRuntimeStatus({ autoSetup: false });
      const managedPath = status.managedEnvPath || 'app-managed python env';
      const hint = `Whisper backend is not configured. Tried Python: ${pythonRuntime.path}. ` +
        `Expected managed env at: ${managedPath}. ` +
        `Install manually with \`${pythonRuntime.path} -m ensurepip --upgrade\` then \`${pythonRuntime.path} -m pip install ${FASTER_WHISPER_PACKAGE_SPEC}\`.`;

      throw new WhisperError(
        `${hint} ${error instanceof Error ? error.message : String(error)}`,
        'WHISPER_NOT_INSTALLED',
        {
          pythonPath: pythonRuntime.path,
          managedEnvPath: managedPath,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  const whisperReady = await hasFasterWhisper(pythonExecutable);
  if (!whisperReady) {
    throw new WhisperError(
      `faster-whisper is still unavailable after setup. Python: ${pythonExecutable}`,
      'WHISPER_NOT_INSTALLED',
      { pythonPath: pythonExecutable }
    );
  }

  // Find transcribe.py script
  const scriptPath = await findTranscribeScript();
  if (!scriptPath) {
    throw new WhisperError('transcribe.py script not found', 'SCRIPT_NOT_FOUND');
  }

  try {
    return await runWhisperProcess({
      pythonExecutable,
      scriptPath,
      transcriptionOptions: options,
      onProgress,
      device: 'auto',
      signal,
    });
  } catch (error) {
    if (!shouldRetryOnCpu(error)) {
      throw error;
    }

    const reason = getWhisperFallbackReason(error);
    console.warn(`[Whisper] transcription GPU fallback: retrying on CPU reason=${JSON.stringify(reason)}`);
    onProgress?.({ percent: 10, status: 'Transcription retrying on CPU...' });

    return runWhisperProcess({
      pythonExecutable,
      scriptPath,
      transcriptionOptions: options,
      onProgress,
      device: 'cpu',
      computeTypeOverride: 'int8',
      signal,
    });
  }
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
