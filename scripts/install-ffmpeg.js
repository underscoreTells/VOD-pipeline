#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const os = require('os');

// Platform detection
const PLATFORM = os.platform();
const ARCH = os.arch();
const IS_DEV = process.env.NODE_ENV !== 'production';

// Platform-specific configurations
const FFmpegConfig = {
  win32: {
    name: 'windows',
    arch: {
      x64: 'amd64',
      ia32: 'x86',
    },
    downloadUrl: () => 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    binaryName: 'ffmpeg.exe',
  },
  darwin: {
    name: 'macos',
    arch: arch => arch,
    downloadUrl: async () => {
      return new Promise((resolve, reject) => {
        const url = 'https://evermeet.cx/ffmpeg/getrelease';
        https.get(url, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve(json.url);
            } catch (e) {
              reject(new Error('Failed to parse FFmpeg release info'));
            }
          });
        }).on('error', (e) => {
          reject(e);
        });
      });
    },
    binaryName: 'ffmpeg',
  },
  linux: {
    name: 'linux',
    arch: {
      x64: 'amd64',
      arm64: 'arm64',
      arm: 'armhf',
      ia32: 'i686',
    },
    downloadUrl: () => {
      const mappedArch = FFmpegConfig.linux.arch[ARCH] || 'amd64';
      return `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${mappedArch}-static.tar.xz`;
    },
    binaryName: 'ffmpeg',
  },
};

// Determine install location
const INSTALL_DIR = IS_DEV
  ? path.join(process.cwd(), 'binaries', PLATFORM)
  : path.join(process.resourcesPath, 'binaries');

async function downloadFile(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        return downloadFile(response.headers.location, destPath, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status: ${response.statusCode}`));
        return;
      }

      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;

      response.pipe(file);

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const percent = ((downloaded / total) * 100).toFixed(1);
          process.stdout.write(`\rDownloading: ${percent}%`);
        }
      });

      response.on('end', () => {
        process.stdout.write('\n');
      });

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function extractArchive(archivePath, destDir, platform) {
  console.log('Extracting archive...');

  if (platform === 'win32' && archivePath.endsWith('.zip')) {
    await extractZip(archivePath, destDir);
  } else if (platform === 'linux' && archivePath.endsWith('.tar.xz')) {
    await extractTarXz(archivePath, destDir);
  } else if (platform === 'darwin' && archivePath.endsWith('.zip')) {
    await extractZip(archivePath, destDir);
  }

  console.log('Extraction complete');
}

async function extractZip(archivePath, destDir) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(destDir, true);
}

async function extractTarXz(archivePath, destDir) {
  const extractDir = path.join(destDir, 'temp_extract');

  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  execSync(`tar -xf "${archivePath}" -C "${extractDir}"`, {
    stdio: 'inherit',
  });

  const extractedFiles = fs.readdirSync(extractDir);
  const buildDir = path.join(extractDir, extractedFiles[0]);
  const ffmpegSrc = path.join(buildDir, 'ffmpeg');
  const ffmpegDest = path.join(destDir, 'ffmpeg');

  if (fs.existsSync(ffmpegSrc)) {
    fs.copyFileSync(ffmpegSrc, ffmpegDest);
    fs.chmodSync(ffmpegDest, 0o755);
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
}

function findBinaryRoot(dir, platform) {
  if (platform === 'win32') {
    const binDir = path.join(dir, 'bin');
    if (fs.existsSync(binDir)) {
      return binDir;
    }
  }

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory() && file.includes('ffmpeg')) {
      return fullPath;
    }
  }
  return dir;
}

async function installFFmpeg() {
  console.log('Installing FFmpeg...\n');

  const config = FFmpegConfig[PLATFORM];
  if (!config) {
    console.error(`Unsupported platform: ${PLATFORM}`);
    process.exit(1);
  }

  const binaryPath = path.join(INSTALL_DIR, config.binaryName);

  if (fs.existsSync(binaryPath)) {
    console.log(`FFmpeg already installed at: ${binaryPath}`);
    return;
  }

  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  const downloadUrl = await config.downloadUrl();
  const archiveName = path.basename(downloadUrl);
  const archivePath = path.join(INSTALL_DIR, archiveName);

  try {
    console.log(`Downloading from: ${downloadUrl}\n`);
    await downloadFile(downloadUrl, archivePath);
    console.log('Download complete\n');

    await extractArchive(archivePath, INSTALL_DIR, PLATFORM);

    const binaryRoot = findBinaryRoot(INSTALL_DIR, PLATFORM);
    if (binaryRoot !== INSTALL_DIR) {
      const srcBinary = path.join(binaryRoot, config.binaryName);
      const destBinary = path.join(INSTALL_DIR, config.binaryName);

      if (fs.existsSync(srcBinary)) {
        console.log(`Moving binary from ${binaryRoot} to ${INSTALL_DIR}`);
        fs.copyFileSync(srcBinary, destBinary);

        if (PLATFORM !== 'win32') {
          fs.chmodSync(destBinary, 0o755);
        }

        fs.rmSync(binaryRoot, { recursive: true, force: true });
      }
    }

    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }

    console.log(`\nFFmpeg installed successfully at: ${binaryPath}`);

    if (PLATFORM === 'darwin') {
      try {
        execSync(`xattr -dr com.apple.quarantine "${binaryPath}"`, { stdio: 'ignore' });
      } catch (err) {
        console.warn('Could not remove quarantine attribute (may not be needed)');
      }
    }

    console.log('\nVerifying installation...');
    const version = execSync(`"${binaryPath}" -version`, { encoding: 'utf8' });
    console.log(version.split('\n')[0]);
    console.log('\nInstallation verified successfully!');
  } catch (err) {
    console.error('\nFFmpeg installation failed:', err.message);
    process.exit(1);
  }
}

installFFmpeg();
