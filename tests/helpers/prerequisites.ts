import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface TestPrerequisite {
  ok: boolean;
  reason: string;
  path?: string;
}

export function requireSupportedNode(expectedMajor: number = 22): TestPrerequisite {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (major === expectedMajor) {
    return { ok: true, reason: `Node ${process.versions.node}` };
  }

  return {
    ok: false,
    reason: `Unsupported Node ${process.versions.node}; expected major ${expectedMajor}.x`,
  };
}

export function requireBuiltAgent(relativePath: string = 'dist/src/agent/index.js'): TestPrerequisite {
  const agentPath = path.resolve(process.cwd(), relativePath);
  if (fs.existsSync(agentPath)) {
    return { ok: true, reason: agentPath, path: agentPath };
  }

  return {
    ok: false,
    reason: `Missing built agent at ${agentPath}`,
    path: agentPath,
  };
}

export function requireNativeModule(moduleName: string): TestPrerequisite {
  try {
    require(moduleName);
    return { ok: true, reason: `${moduleName} loaded successfully` };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function requireBinary(command: string, args: string[] = ['--version']): TestPrerequisite {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    const detail = (result.stdout || result.stderr || '').trim().split('\n')[0] || `${command} available`;
    return { ok: true, reason: detail };
  }

  return {
    ok: false,
    reason: result.error?.message || result.stderr?.trim() || `${command} unavailable`,
  };
}

export function combinePrerequisites(...checks: TestPrerequisite[]): TestPrerequisite {
  const failed = checks.find((check) => !check.ok);
  if (failed) {
    return failed;
  }

  return { ok: true, reason: 'All prerequisites satisfied' };
}
