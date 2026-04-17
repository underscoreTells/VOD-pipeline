import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const electronPackageDir = path.dirname(require.resolve('electron/package.json'));

const pathFile = path.join(electronPackageDir, 'path.txt');
const distDir = path.join(electronPackageDir, 'dist');
const installScript = path.join(electronPackageDir, 'install.js');

const isElectronInstalled = () => fs.existsSync(pathFile) && fs.existsSync(distDir);

if (isElectronInstalled()) {
  console.log('Electron binary already installed.');
  process.exit(0);
}

if (!fs.existsSync(installScript)) {
  console.error(`Electron install script not found: ${installScript}`);
  process.exit(1);
}

console.log('Electron binary missing. Running Electron installer...');

const result = spawnSync(process.execPath, [installScript], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!isElectronInstalled()) {
  console.error('Electron installer completed but the binary is still missing.');
  process.exit(1);
}

console.log('Electron binary installed successfully.');
