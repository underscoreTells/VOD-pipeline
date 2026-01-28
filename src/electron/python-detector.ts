import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export interface PythonPathResult {
  path: string;
  source: 'bundled' | 'system';
  version: string;
}

let cachedResult: PythonPathResult | null = null;

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
    const proc = spawn(pythonPath, ['-c', `import ${packageName}`]);

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
