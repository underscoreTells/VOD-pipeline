import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

export const BACKEND_BUILD_ROOTS = [
  'dist/src/electron',
  'dist/src/agent',
  'dist/src/shared',
  'dist/src/pipeline',
] as const;

interface DevRuntimeSnapshot {
  runtimeSessionId: string;
  initializedAt: string;
  startupFingerprint: number;
}

export interface BackendRuntimeStaleness {
  runtimeSessionId: string;
  initializedAt: string;
  startupFingerprint: number;
  currentFingerprint: number;
}

let devRuntimeSnapshot: DevRuntimeSnapshot | null = null;

export function isDevelopmentElectronRuntime(): boolean {
  return !app.isPackaged;
}

export async function computeBackendBuildFingerprint(
  baseDir = process.cwd(),
  relativeRoots: readonly string[] = BACKEND_BUILD_ROOTS
): Promise<number> {
  let latestMtimeMs = 0;

  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = path.resolve(baseDir, relativeRoot);
    latestMtimeMs = Math.max(latestMtimeMs, await computeDirectoryLatestMtime(absoluteRoot));
  }

  return latestMtimeMs;
}

async function computeDirectoryLatestMtime(directoryPath: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  let latestMtimeMs = 0;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      latestMtimeMs = Math.max(latestMtimeMs, await computeDirectoryLatestMtime(entryPath));
      continue;
    }

    try {
      const entryStats = await stat(entryPath);
      latestMtimeMs = Math.max(latestMtimeMs, entryStats.mtimeMs);
    } catch {
      // Ignore files that disappear during traversal.
    }
  }

  return latestMtimeMs;
}

export async function initializeDevRuntimeState(baseDir = process.cwd()): Promise<void> {
  if (!isDevelopmentElectronRuntime()) {
    devRuntimeSnapshot = null;
    return;
  }

  devRuntimeSnapshot = {
    runtimeSessionId: randomUUID(),
    initializedAt: new Date().toISOString(),
    startupFingerprint: await computeBackendBuildFingerprint(baseDir),
  };
}

export function getDevRuntimeSnapshot(): DevRuntimeSnapshot | null {
  return devRuntimeSnapshot;
}

export async function getBackendRuntimeStaleness(
  baseDir = process.cwd()
): Promise<BackendRuntimeStaleness | null> {
  if (!isDevelopmentElectronRuntime()) {
    return null;
  }

  if (!devRuntimeSnapshot) {
    await initializeDevRuntimeState(baseDir);
  }

  if (!devRuntimeSnapshot) {
    return null;
  }

  const currentFingerprint = await computeBackendBuildFingerprint(baseDir);
  if (currentFingerprint <= devRuntimeSnapshot.startupFingerprint) {
    return null;
  }

  return {
    runtimeSessionId: devRuntimeSnapshot.runtimeSessionId,
    initializedAt: devRuntimeSnapshot.initializedAt,
    startupFingerprint: devRuntimeSnapshot.startupFingerprint,
    currentFingerprint,
  };
}

export function resetDevRuntimeStateForTests(): void {
  devRuntimeSnapshot = null;
}
