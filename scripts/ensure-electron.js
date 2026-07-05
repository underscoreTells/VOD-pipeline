import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const electronPackageDir = path.dirname(require.resolve('electron/package.json'));
const electronVersion = require('electron/package.json').version;

const pathFile = path.join(electronPackageDir, 'path.txt');
const distDir = path.join(electronPackageDir, 'dist');
const installScript = path.join(electronPackageDir, 'install.js');

function getPlatformPath() {
  switch (os.platform()) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error('Electron builds are not available on platform: ' + os.platform());
  }
}

function isElectronInstalled() {
  if (!fs.existsSync(pathFile) || !fs.existsSync(distDir)) {
    return false;
  }

  const platformPath = getPlatformPath();
  const expectedPath = process.env.ELECTRON_OVERRIDE_DIST_PATH
    ? path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, platformPath)
    : path.join(distDir, platformPath);

  return fs.existsSync(expectedPath);
}

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
  console.warn(
    'Electron installer completed but the binary is still missing. ' +
      'This is a known issue on newer Node.js versions where the bundled ' +
      'yauzl/fd-slicer stream pipeline hangs during extraction. ' +
      'Falling back to manual extraction...',
  );

  try {
    extractWithFallback();
  } catch (error) {
    console.error('Fallback extraction failed:', error);
    process.exit(1);
  }
}

console.log('Electron binary installed successfully.');

function extractWithFallback() {
  const zipPath = resolveCachedZip();

  if (!fs.existsSync(zipPath)) {
    throw new Error(
      `Cached Electron zip not found: ${zipPath}. ` +
        'Delete node_modules/electron and re-run pnpm install to re-download.',
    );
  }

  console.log(`Extracting Electron ${electronVersion} from cached zip: ${zipPath}`);

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  const unzipResult = spawnSync('unzip', ['-o', '-q', zipPath, '-d', distDir], {
    stdio: 'inherit',
  });

  if (unzipResult.status !== 0) {
    throw new Error(`unzip exited with code ${unzipResult.status ?? 0}. Install unzip or use Node 22.`);
  }

  const platformPath = getPlatformPath();
  const expectedPath =
    process.env.ELECTRON_OVERRIDE_DIST_PATH
      ? path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, platformPath)
      : path.join(distDir, platformPath);

  if (!fs.existsSync(expectedPath)) {
    throw new Error(
      `Extraction completed but expected binary not found: ${expectedPath}`,
    );
  }

  fs.writeFileSync(pathFile, platformPath);

  if (!isElectronInstalled()) {
    throw new Error('Extraction completed but verification failed.');
  }

  console.log(`Electron ${electronVersion} extracted via fallback (unzip).`);
}

function resolveCachedZip() {
  const zipPath = spawnSync(process.execPath, [
    '-e',
    [
      `const { downloadArtifact } = require('@electron/get');`,
      `downloadArtifact({`,
      `  version: ${JSON.stringify(electronVersion)},`,
      `  artifactName: 'electron',`,
      `  platform: ${JSON.stringify(process.env.npm_config_platform || process.platform)},`,
      `  arch: ${JSON.stringify(process.env.npm_config_arch || process.arch)},`,
      `}).then(p => process.stdout.write(p)).catch(e => { console.error(e); process.exit(1); });`,
    ].join('\n'),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (zipPath.status !== 0) {
    throw new Error(`Failed to resolve cached Electron zip: ${zipPath.stderr}`);
  }

  return zipPath.stdout.trim();
}
