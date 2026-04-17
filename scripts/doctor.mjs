import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const expectedNodeMajor = 22;
const requireAgentBuild = process.argv.includes('--require-agent-build');

function checkNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  const ok = major === expectedNodeMajor;
  return {
    name: 'node',
    ok,
    required: true,
    detail: ok
      ? `Detected Node ${process.versions.node}`
      : `Detected Node ${process.versions.node}; expected major ${expectedNodeMajor}.x`,
  };
}

function checkBinary(command, args = ['--version'], required = false) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ok = result.status === 0;
  const detail = ok
    ? (result.stdout || result.stderr || '').trim().split('\n')[0] || 'available'
    : (result.error?.message || result.stderr || 'not available').trim();

  return {
    name: command,
    ok,
    required,
    detail,
  };
}

function checkPnpm() {
  return checkBinary('pnpm', ['--version'], true);
}

function checkNativeModule(moduleName) {
  try {
    require(moduleName);
    return {
      name: `${moduleName} native module`,
      ok: true,
      required: true,
      detail: 'loaded successfully',
    };
  } catch (error) {
    return {
      name: `${moduleName} native module`,
      ok: false,
      required: true,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkAgentBuild() {
  const agentPath = path.join(cwd, 'dist', 'src', 'agent', 'index.js');
  const ok = fs.existsSync(agentPath);

  return {
    name: 'agent build',
    ok,
    required: requireAgentBuild,
    detail: ok ? agentPath : `Missing ${agentPath}`,
  };
}

const checks = [
  checkNode(),
  checkPnpm(),
  checkNativeModule('better-sqlite3'),
  checkBinary('ffmpeg'),
  checkBinary('audiowaveform'),
  checkBinary('python3'),
  checkAgentBuild(),
];

let failed = false;

console.log('VOD Pipeline doctor\n');

for (const check of checks) {
  const status = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN';
  console.log(`${status.padEnd(4)} ${check.name}: ${check.detail}`);
  if (!check.ok && check.required) {
    failed = true;
  }
}

if (failed) {
  console.error('\nDoctor failed. Fix required checks before relying on the local dev/test workflow.');
  process.exit(1);
}

console.log('\nDoctor completed. Optional warnings may still limit media or integration features.');
