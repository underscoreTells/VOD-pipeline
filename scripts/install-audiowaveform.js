#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { execSync } from 'child_process';
import os from 'os';

// Platform detection
const PLATFORM = os.platform();
const ARCH = os.arch();
const IS_DEV = process.env.NODE_ENV !== 'production';

// audiowaveform release version
const AUDIOWAVEFORM_VERSION = '1.10.2';

// Platform-specific configurations
const AudiowaveformConfig = {
  win32: {
    name: 'windows',
    arch: {
      x64: 'win64',
      ia32: 'win32',
    },
    downloadUrl: () => {
      const mappedArch = AudiowaveformConfig.win32.arch[ARCH] || 'win64';
      return `https://github.com/bbc/audiowaveform/releases/download/${AUDIOWAVEFORM_VERSION}/audiowaveform-${AUDIOWAVEFORM_VERSION}-${mappedArch}.zip`;
    },
    binaryName: 'audiowaveform.exe',
  },
  darwin: {
    name: 'macos',
    arch: arch => arch,
    downloadUrl: () => {
      // macOS static binary from GitHub releases
      return `https://github.com/bbc/audiowaveform/releases/download/${AUDIOWAVEFORM_VERSION}/audiowaveform-${AUDIOWAVEFORM_VERSION}-osx.zip`;
    },
    binaryName: 'audiowaveform',
  },
  linux: {
    name: 'linux',
    arch: {
      x64: 'amd64',
      arm64: 'arm64',
    },
    downloadUrl: () => {
      const mappedArch = AudiowaveformConfig.linux.arch[ARCH] || 'amd64';
      // Use Debian 12 (bookworm) as it's widely compatible
      return `https://github.com/bbc/audiowaveform/releases/download/${AUDIOWAVEFORM_VERSION}/audiowaveform_${AUDIOWAVEFORM_VERSION}-1-12_${mappedArch}.deb`;
    },
    binaryName: 'audiowaveform',
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
          process.stdout.write(`\rDownloading audiowaveform: ${percent}%`);
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

async function extractZip(zipPath, destDir) {
  console.log('Extracting zip archive...');
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  console.log('Extraction complete');
}

async function extractDeb(debPath, destDir) {
  console.log('Extracting debian package...');
  
  // Create temp extraction directory
  const extractDir = path.join(destDir, 'temp_extract');
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  try {
    // Extract .deb package using dpkg-deb
    execSync(`dpkg-deb -x "${debPath}" "${extractDir}"`, {
      stdio: 'ignore',
    });

    // Find the binary (usually in usr/bin/)
    const binarySrc = path.join(extractDir, 'usr', 'bin', 'audiowaveform');
    const binaryDest = path.join(destDir, 'audiowaveform');

    if (fs.existsSync(binarySrc)) {
      fs.copyFileSync(binarySrc, binaryDest);
      fs.chmodSync(binaryDest, 0o755);
      console.log('Installed: audiowaveform');
    } else {
      throw new Error('audiowaveform binary not found in extracted package');
    }
  } finally {
    // Cleanup temp directory
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }
}

async function isArchLinux() {
  try {
    // Check /etc/arch-release (exists on Arch and most derivatives like Manjaro, EndeavourOS)
    if (fs.existsSync('/etc/arch-release')) {
      return true;
    }
    
    // Fallback: check os-release for arch in ID or ID_LIKE
    if (fs.existsSync('/etc/os-release')) {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const idMatch = osRelease.match(/^ID=(.+)$/m);
      const idLikeMatch = osRelease.match(/^ID_LIKE=(.+)$/m);
      
      const id = idMatch ? idMatch[1].toLowerCase() : '';
      const idLike = idLikeMatch ? idLikeMatch[1].toLowerCase() : '';
      
      // Arch or any Arch-based distro (Manjaro, EndeavourOS, etc.)
      if (id.includes('arch') || idLike.includes('arch')) {
        return true;
      }
    }
    
    return false;
  } catch {
    return false;
  }
}

async function isFedoraBased() {
  try {
    if (fs.existsSync('/etc/fedora-release') || fs.existsSync('/etc/redhat-release')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function installAudiowaveform() {
  console.log('Installing audiowaveform...\n');

  // Check if already installed
  const binaryPath = path.join(INSTALL_DIR, PLATFORM === 'win32' ? 'audiowaveform.exe' : 'audiowaveform');
  
  if (fs.existsSync(binaryPath)) {
    console.log(`audiowaveform already installed at: ${INSTALL_DIR}`);
    return;
  }

  // Special handling for Arch Linux
  if (PLATFORM === 'linux' && await isArchLinux()) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  Arch Linux Detected                                       ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  audiowaveform is available via AUR. Please install it:    ║');
    console.log('║                                                            ║');
    console.log('║  Using yay:                                                ║');
    console.log('║    yay -S audiowaveform                                    ║');
    console.log('║                                                            ║');
    console.log('║  Using paru:                                               ║');
    console.log('║    paru -S audiowaveform                                   ║');
    console.log('║                                                            ║');
    console.log('║  Or manually from AUR:                                     ║');
    console.log('║    git clone https://aur.archlinux.org/audiowaveform.git   ║');
    console.log('║    cd audiowaveform                                        ║');
    console.log('║    makepkg -si                                             ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    
    // Don't fail the install, just warn
    console.log('Continuing without auto-installation for Arch Linux...\n');
    return;
  }

  // Special handling for Fedora/RHEL - use RPM instead of DEB
  if (PLATFORM === 'linux' && await isFedoraBased()) {
    console.log('Fedora/RHEL detected. Using RPM package instead of DEB.');
    
    // Override the download URL for RPM
    const mappedArch = AudiowaveformConfig.linux.arch[ARCH] || 'x86_64';
    const rpmUrl = `https://github.com/bbc/audiowaveform/releases/download/${AUDIOWAVEFORM_VERSION}/audiowaveform-${AUDIOWAVEFORM_VERSION}-1.el8.${mappedArch}.rpm`;
    
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    
    const archiveName = path.basename(rpmUrl);
    const archivePath = path.join(INSTALL_DIR, archiveName);
    
    try {
      console.log(`Downloading from: ${rpmUrl}\n`);
      await downloadFile(rpmUrl, archivePath);
      console.log('Download complete\n');
      
      // Extract RPM using rpm2cpio
      await extractRpm(archivePath, INSTALL_DIR);
      
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }
      
      console.log(`\naudiowaveform installed successfully at: ${binaryPath}`);
      
      // Verify installation
      console.log('\nVerifying installation...');
      const version = execSync(`"${binaryPath}" --version`, { encoding: 'utf8' });
      console.log(version.trim());
      console.log('\nInstallation verified successfully!');
      return;
    } catch (err) {
      console.error('\naudiowaveform installation failed:', err.message);
      process.exit(1);
    }
  }

  const config = AudiowaveformConfig[PLATFORM];
  if (!config) {
    console.error(`Unsupported platform: ${PLATFORM}`);
    process.exit(1);
  }

  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  const downloadUrl = config.downloadUrl();
  const archiveName = path.basename(downloadUrl);
  const archivePath = path.join(INSTALL_DIR, archiveName);

  try {
    console.log(`Downloading from: ${downloadUrl}\n`);
    await downloadFile(downloadUrl, archivePath);
    console.log('Download complete\n');

    // Extract based on archive type
    if (PLATFORM === 'win32' || PLATFORM === 'darwin') {
      await extractZip(archivePath, INSTALL_DIR);
    } else if (PLATFORM === 'linux') {
      await extractDeb(archivePath, INSTALL_DIR);
    }

    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }

    console.log(`\naudiowaveform installed successfully at: ${binaryPath}`);

    // Verify installation
    console.log('\nVerifying installation...');
    const version = execSync(`"${binaryPath}" --version`, { encoding: 'utf8' });
    console.log(version.trim());
    console.log('\nInstallation verified successfully!');
  } catch (err) {
    console.error('\naudiowaveform installation failed:', err.message);
    process.exit(1);
  }
}

async function extractRpm(rpmPath, destDir) {
  console.log('Extracting RPM package...');
  
  // Create temp extraction directory
  const extractDir = path.join(destDir, 'temp_extract');
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  try {
    // Extract RPM using rpm2cpio and cpio
    execSync(`rpm2cpio "${rpmPath}" | cpio -idmv -D "${extractDir}"`, {
      stdio: 'ignore',
    });

    // Find the binary (usually in usr/bin/)
    const binarySrc = path.join(extractDir, 'usr', 'bin', 'audiowaveform');
    const binaryDest = path.join(destDir, 'audiowaveform');

    if (fs.existsSync(binarySrc)) {
      fs.copyFileSync(binarySrc, binaryDest);
      fs.chmodSync(binaryDest, 0o755);
      console.log('Installed: audiowaveform');
    } else {
      throw new Error('audiowaveform binary not found in extracted package');
    }
  } finally {
    // Cleanup temp directory
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }
}

installAudiowaveform();
