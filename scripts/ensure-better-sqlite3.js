import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const packageDir = path.join(repoRoot, 'node_modules', 'better-sqlite3');
const bindingPath = path.join(packageDir, 'build', 'Release', 'better_sqlite3.node');
const prebuildInstallScript = path.join(repoRoot, 'node_modules', 'prebuild-install', 'bin.js');
const electronVersion = require('electron/package.json').version;

if (!fs.existsSync(packageDir)) {
  console.error(`better-sqlite3 package not found: ${packageDir}`);
  process.exit(1);
}

if (!fs.existsSync(prebuildInstallScript)) {
  console.error(`prebuild-install script not found: ${prebuildInstallScript}`);
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_PATH;

fs.rmSync(path.join(packageDir, 'build'), { recursive: true, force: true });

console.log(
  `Installing better-sqlite3 native binding for Electron ${electronVersion}...`,
);

const result = spawnSync(
  process.execPath,
  [
    prebuildInstallScript,
    '--runtime=electron',
    `--target=${electronVersion}`,
  ],
  {
  cwd: packageDir,
  stdio: 'inherit',
  env,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(bindingPath)) {
  console.error('better-sqlite3 install completed but the native binding is still missing.');
  process.exit(1);
}

console.log('better-sqlite3 native binding installed successfully.');
