import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export interface PythonPathResult {
  path: string;
  source: 'managed' | 'bundled' | 'system';
  version: string;
}

let cachedResult: PythonPathResult | null = null;

interface PythonCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function getManagedPythonCandidates(): Promise<string[]> {
  try {
    const { app } = await import('electron');
    const userDataPath = app.getPath('userData');
    const venvDir = path.join(userDataPath, 'python-runtime', 'venv');

    if (process.platform === 'win32') {
      return [
        path.join(venvDir, 'Scripts', 'python.exe'),
        path.join(venvDir, 'Scripts', 'python3.exe'),
      ];
    }

    return [
      path.join(venvDir, 'bin', 'python'),
      path.join(venvDir, 'bin', 'python3'),
    ];
  } catch {
    return [];
  }
}

async function runPythonCommand(
  executablePath: string,
  args: string[],
  timeoutMs = 120000
): Promise<PythonCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(executablePath, args);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${executablePath} ${args.join(' ')}`));
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Detect Python installation
 * 1. Bundled Python (if exists)
 * 2. System: python3 then python
 */
export async function detectPython(): Promise<PythonPathResult | null> {
  if (cachedResult) {
    return cachedResult;
  }

  const platform = process.platform;
  const binaryNames = platform === 'win32'
    ? ['python.exe', 'python3.exe']
    : ['python3', 'python'];

  const managedPaths = await getManagedPythonCandidates();
  for (const managedPath of managedPaths) {
    if (!fs.existsSync(managedPath)) {
      continue;
    }

    const version = await getPythonVersion(managedPath);
    if (version) {
      cachedResult = { path: managedPath, source: 'managed', version };
      console.log(`[Python] Found managed runtime at: ${managedPath} (version: ${version})`);
      return cachedResult;
    }
  }

  // Check bundled Python first
  const resourcesPath = process.resourcesPath || process.cwd();
  const bundledPaths = [
    path.join(resourcesPath, 'python', platform === 'win32' ? 'python.exe' : 'bin/python'),
    path.join(process.cwd(), 'python', platform === 'win32' ? 'python.exe' : 'bin/python'),
  ];

  for (const bundledPath of bundledPaths) {
    if (fs.existsSync(bundledPath)) {
      const version = await getPythonVersion(bundledPath);
      if (version) {
        cachedResult = { path: bundledPath, source: 'bundled', version };
        console.log(`[Python] Found bundled at: ${bundledPath} (version: ${version})`);
        return cachedResult;
      }
    }
  }

  // Check system Python
  for (const binaryName of binaryNames) {
    const version = await getPythonVersion(binaryName);
    if (version) {
      cachedResult = { path: binaryName, source: 'system', version };
      console.log(`[Python] Found system at: ${binaryName} (version: ${version})`);
      return cachedResult;
    }
  }

  console.warn('[Python] No Python installation found');
  return null;
}

/**
 * Get cached Python detection result
 */
export function getPythonPath(): PythonPathResult | null {
  return cachedResult;
}

/**
 * Clear cached detection result (for testing)
 */
export function clearPythonCache(): void {
  cachedResult = null;
}

/**
 * Extract version string from Python
 */
export async function getPythonVersion(executablePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(executablePath, ['--version']);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      // Python outputs version to stderr
      output += data.toString();
    });

    proc.on('error', () => resolve(null));

    proc.on('exit', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      // Parse version: "Python 3.9.7" or "Python 3.10.0"
      const match = output.match(/Python\s+(\d+\.\d+\.?\d*)/i);
      resolve(match ? match[1] : null);
    });
  });
}

/**
 * Check if a Python package is installed
 */
export async function hasPythonPackage(pythonPath: string, packageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Use argv to pass package name safely (avoid injection)
    const script = 'import importlib, sys; importlib.import_module(sys.argv[1]); sys.exit(0)';
    const proc = spawn(pythonPath, ['-c', script, packageName]);

    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Check if faster-whisper is available
 */
export async function hasFasterWhisper(pythonPath: string): Promise<boolean> {
  return hasPythonPackage(pythonPath, 'faster_whisper');
}

/**
 * Check if pip is available for a Python executable.
 */
export async function hasPip(pythonPath: string): Promise<boolean> {
  try {
    const result = await runPythonCommand(pythonPath, ['-m', 'pip', '--version']);
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * Ensure pip is available (bootstraps via ensurepip when missing).
 */
export async function ensurePip(pythonPath: string): Promise<void> {
  if (await hasPip(pythonPath)) {
    return;
  }

  const bootstrap = await runPythonCommand(pythonPath, ['-m', 'ensurepip', '--upgrade']);
  if (bootstrap.code !== 0) {
    throw new Error(
      `Failed to bootstrap pip for ${pythonPath}: ${bootstrap.stderr || bootstrap.stdout || 'unknown error'}`
    );
  }

  if (!(await hasPip(pythonPath))) {
    throw new Error(`pip is still unavailable after ensurepip for ${pythonPath}`);
  }
}

/**
 * Run pip install for a Python executable.
 */
export async function pipInstall(pythonPath: string, args: string[]): Promise<void> {
  const result = await runPythonCommand(pythonPath, ['-m', 'pip', ...args], 600000);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pip command failed with code ${result.code}`);
  }
}

/**
 * Create a venv using a base Python executable.
 */
export async function createVirtualEnv(basePythonPath: string, venvPath: string): Promise<void> {
  const result = await runPythonCommand(basePythonPath, ['-m', 'venv', venvPath], 300000);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `venv creation failed with code ${result.code}`);
  }
}
