# FFmpeg Binary Installation in Electron Applications

## Table of Contents
1. [FFmpeg Binary Distribution](#ffmpeg-binary-distribution)
2. [Electron Post-Install Script Patterns](#electron-post-install-script-patterns)
3. [Cross-Platform Packaging](#cross-platform-packaging)
4. [electron-builder Integration](#electron-builder-integration)
5. [Runtime FFmpeg Usage](#runtime-ffmpeg-usage)

---

## FFmpeg Binary Distribution

### Official Sources for Static FFmpeg Binaries

#### Windows
- **Source**: [Gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/)
- **Download URLs**:
  - Essentials build (Windows 7+): 
    ```
    https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
    https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z
    ```
  - Full build (Windows 10+):
    ```
    https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z
    https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-full.7z
    ```
- **File Structure**: 
  ```
  ffmpeg-git-essentials.7z
  ├── bin/
  │   ├── ffmpeg.exe
  │   ├── ffplay.exe
  │   └── ffprobe.exe
  ├── ffmpeg.exe (at root)
  ├── ffprobe.exe
  └── doc/
  ```
- **License**: GPLv3 static builds
- **Recommendation**: Use the essentials build for most use cases (~31 MB vs larger full builds)

#### macOS
- **Source**: [evermeet.cx FFmpeg](https://evermeet.cx/ffmpeg/)
- **Download URLs**:
  ```
  https://evermeet.cx/ffmpeg/getrelease (latest release as zip)
  https://evermeet.cx/ffmpeg/getrelease/zip (latest release explicitly)
  https://evermeet.cx/ffmpeg/get (latest git snapshot as zip)
  ```
- **File Structure**:
  ```
  ffmpeg-X.Y.Z.zip
  ├── ffmpeg
  ├── ffprobe
  └── (optional) ffplay
  ```
- **License**: GPLv3 (Intel 64-bit)
- **Note**: No native Apple Silicon builds available from this source (ARM runs via Rosetta)
- **Quarantine**: macOS 10.15+ requires removing quarantine: `xattr -dr com.apple.quarantine ffmpeg`

#### Linux
- **Source**: [John Van Sickle FFmpeg Static Builds](https://johnvansickle.com/ffmpeg/)
- **Download URLs**:
  ```
  https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
  https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz
  ```
- **Architectures**: 
  - `amd64` (x86_64)
  - `i686` (32-bit)
  - `arm64` (aarch64)
  - `armhf` (ARM hard float)
  - `armel` (ARM little endian)
- **File Structure**:
  ```
  ffmpeg-release-amd64-static.tar.xz
  └── ffmpeg-git-2024xxxxx-amar64-static/
      ├── ffmpeg
      ├── ffprobe
      └── (optional) ffplay
  ```
- **License**: GPLv3 static builds
- **Requirements**: Linux kernel 3.2.0+

### Alternative: NPM Package Approach

#### @ffmpeg-installer/ffmpeg
- **Package**: `@ffmpeg-installer/ffmpeg`
- **Approach**: Uses `optionalDependencies` with platform-specific overrides
- **Binary sources**:
  - Linux 64-bit: johnvansickle.com
  - macOS: osxexperts.net / evermeet.cx
  - Windows 64-bit: ffmpeg.zeranoe.com (historical)
- **Usage**:
  ```javascript
  const ffmpeg = require('@ffmpeg-installer/ffmpeg');
  console.log(ffmpeg.path); // Path to installed binary
  console.log(ffmpeg.version); // Version string
  ```
- **Pros**: 
  - Simplicity - just runs a postinstall script automatically
  - Platform detection handled by npm
- **Cons**:
  - Windows binaries source is outdated (zeranoe.com shutdown)
  - No control over binary version
  - Potential warnings from optionalDependencies

---

## Electron Post-Install Script Patterns

### npm Lifecycle Hooks

#### Standard Post-Install Script
```json
{
  "scripts": {
    "postinstall": "node scripts/install-ffmpeg.js"
  }
}
```

#### Lifecycle Execution Order
When running `npm install`:
1. `preinstall`
2. `install`
3. `postinstall` ← FFmpeg download/extract script
4. `prepublish` (deprecated, but runs)
5. `prepare` (often runs after postinstall)

The `postinstall` script runs:
- After `npm install` completes
- After `npm ci` (clean install) completes
- After `npm rebuild` (when native modules are rebuilt)
- **Does NOT run in production when app is packaged**

### Custom Install Script Example

**scripts/install-ffmpeg.js**:
```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const os = require('os');
const { unzip } = require('unzipper'); // npm install unzipper

// Platform detection
const PLATFORM = os.platform();
const ARCH = os.arch();
const IS_DEV = process.env.NODE_ENV === 'development';

// Platform-specific configurations
const FFmpegConfig = {
  win32: {
    name: 'windows',
    arch: {
      x64: 'amd64',
      ia32: 'x86',
    },
    downloadUrl: (version = '8.0.1') => 
      `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip`,
    binaryName: 'ffmpeg.exe',
  },
  darwin: {
    name: 'macos',
    arch: arch => arch, // arm64 or x64
    downloadUrl: () => 'https://evermeet.cx/ffmpeg/getrelease',
    binaryName: 'ffmpeg',
  },
  linux: {
    name: 'linux',
    arch: {
      x64: 'amd64',
      arm64: 'aarch64',
      arm: 'armhf',
      ia32: 'x86',
    },
    downloadUrl: () => 
      'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    binaryName: 'ffmpeg',
  },
};

// Determine install location
const INSTALL_DIR = IS_DEV 
  ? path.join(process.cwd(), 'binaries')
  : path.join(process.resourcesPath, 'binaries');

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirects
        return downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {}); // Clean up on error
      reject(err);
    });
  });
}

async function extractArchive(archivePath, destDir, platform) {
  if (platform === 'win32' && archivePath.endsWith('.zip')) {
    // Extract ZIP on Windows
    await fs.createReadStream(archivePath)
      .pipe(unzip.Extract({ path: destDir }))
      .promise();
  } else if (platform === 'linux' && archivePath.endsWith('.tar.xz')) {
    // Extract tar.xz on Linux using system command
    const extractDir = path.join(destDir, 'temp_extract');
    
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }
    
    execSync(`tar -xf "${archivePath}" -C "${extractDir}"`);
    
    // Move extracted binary to destDir
    const extractedFiles = fs.readdirSync(extractDir);
    const buildDir = path.join(extractDir, extractedFiles[0]);
    const ffmpegSrc = path.join(buildDir, 'ffmpeg');
    const ffmpegDest = path.join(destDir, 'ffmpeg');
    
    fs.copyFileSync(ffmpegSrc, ffmpegDest);
    fs.chmodSync(ffmpegDest, 0o755); // Make executable
    
    // Cleanup
    fs.rmSync(extractDir, { recursive: true, force: true });
  } else if (platform === 'darwin' && archivePath.endsWith('.zip')) {
    // macOS ZIP (just ffmpeg binary)
    await fs.createReadStream(archivePath)
      .pipe(unzip.Extract({ path: destDir }))
      .promise();
  }
}

function findBinaryRoot(dir, platform) {
  // Sometimes binaries are nested in subdirectories
  if (platform === 'win32') {
    // Windows builds have bin/ folder
    const binDir = path.join(dir, 'bin');
    if (fs.existsSync(binDir)) {
      return binDir;
    }
  }
  // Linux builds have a folder named like ffmpeg-git-xxxxx-amd64-static
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
  console.log('Installing FFmpeg...');
  
  // Check if already installed
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
  
  // Create install directory
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  
  // Download archive
  const downloadUrl = config.downloadUrl();
  const archiveName = path.basename(downloadUrl);
  const archivePath = path.join(INSTALL_DIR, archiveName);
  
  console.log(`Downloading from: ${downloadUrl}`);
  await downloadFile(downloadUrl, archivePath);
  console.log('Download complete');
  
  // Extract
  console.log('Extracting...');
  await extractArchive(archivePath, INSTALL_DIR, PLATFORM);
  
  // Find and copy binary to root if nested
  const binaryRoot = findBinaryRoot(INSTALL_DIR, PLATFORM);
  if (binaryRoot !== INSTALL_DIR) {
    const srcBinary = path.join(binaryRoot, config.binaryName);
    const destBinary = path.join(INSTALL_DIR, config.binaryName);
    
    console.log(`Moving binary from ${binaryRoot} to ${INSTALL_DIR}`);
    fs.copyFileSync(srcBinary, destBinary);
    
    // Make executable on *nix
    if (PLATFORM !== 'win32') {
      fs.chmodSync(destBinary, 0o755);
    }
    
    // Cleanup nested directory
    fs.rmSync(binaryRoot, { recursive: true, force: true });
  }
  
  // Cleanup archive
  fs.unlinkSync(archivePath);
  
  console.log(`FFmpeg installed successfully at: ${binaryPath}`);
  
  // Verify installation
  try {
    execSync(`"${binaryPath}" -version`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to verify FFmpeg installation');
    process.exit(1);
  }
}

// Run installation
installFFmpeg().catch(err => {
  console.error('FFmpeg installation failed:', err);
  process.exit(1);
});
```

### Alternative: Runtime Installation (First Launch)

Instead of postinstall (which only runs in dev), install on first app launch:

```javascript
// src/electron/main.ts - Runtime FFmpeg installation
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

async function ensureFFmpegInstalled() {
  const binariesDir = path.join(
    app.getPath('userData'), // or process.resourcesPath for bundled
    'binaries'
  );
  
  const ffmpegPath = path.join(binariesDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  
  if (fs.existsSync(ffmpegPath)) {
    return ffmpegPath;
  }
  
  // Download and install...
  // (similar download logic as postinstall script)
  
  return ffmpegPath;
}

// Run on app ready
app.whenReady().then(async () => {
  const ffmpegPath = await ensureFFmpegInstalled();
  // Store for use throughout app...
});
```

---

## Cross-Platform Packaging

### Installation Directory Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **App Directory** (`process.resourcesPath`) | Bundled with app | Always available, no downloads needed | Increases app size, needs ASAR unpacking |
| **User Data Directory** (`app.getPath('userData')`) | Downloaded on first run | Smaller distribution, can update independently | Needs download on first launch, network required |
| **Custom Path** | User-specified or system PATH | No bloat, uses system FFmpeg | Not guaranteed, different versions/feature sets |

### Windows Specifics

#### Download and Setup
```javascript
// Windows FFmpeg download configuration
const WindowsFFmpegConfig = {
  // Essentials is recommended (~31 MB)
  url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  
  // Alternative: Git build (more features, updated more frequently)
  // url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z',
  
  // Binary locations inside archive
  binPath: './bin/ffmpeg.exe',
  
  // File permissions
  chmod: false, // Windows doesn't use chmod
};

// Extraction requires 7z for .7z or unzipper for .zip
// Use .zip for compatibility with Node.js unzipper package
```

#### PATH Configuration (Optional)
```javascript
// Windows: Add to PATH for user session
const { exec } = require('child_process');

function addToWindowsPath(ffmpegDir) {
  // Using PowerShell to add to user PATH
  const psCommand = `
    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($path -notlike "*${ffmpegDir}*") {
      [Environment]::SetEnvironmentVariable('Path', "${path};${ffmpegDir}", 'User')
    }
  `;
  
  exec(`powershell -Command "${psCommand}"`, (err) => {
    if (err) console.error('Failed to add to PATH:', err);
  });
}
```

**Note**: Adding to PATH is generally unnecessary and not recommended. Use absolute paths instead.

### macOS Specifics

#### Download and Setup
```javascript
// macOS FFmpeg download configuration
const MacFFmpegConfig = {
  // Use evermeet.cx for macOS static builds
  url: 'https://evermeet.cx/ffmpeg/getrelease', // Latest release
  // url: 'https://evermeet.cx/ffmpeg/get',        // Latest git snapshot
  
  binaryName: 'ffmpeg',
  
  // Remove quarantine attribute required by macOS 10.15+
  removeQuarantine: true,
};

// Extract with unzipper (zip format)
```

#### Quarantine Removal
```javascript
const { execSync } = require('child_process');

function removeQuarantine(binaryPath) {
  try {
    execSync(`xattr -dr com.apple.quarantine "${binaryPath}"`);
  } catch (err) {
    console.warn('Failed to remove quarantine attribute:', err.message);
  }
}

// Grant executable permissions
fs.chmodSync(binaryPath, 0o755);
```

#### Code Signing Considerations
If distributing a notarized macOS app:
- Bundled FFmpeg binary must be included in code signing
- Use `electron-builder`'s `asarUnpack` to extract binary before signing
- Binary must be hardened (unless exempted)

```json
// electron-builder config
{
  "mac": {
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "entitlements.mac.plist",
    "entitlementsInherit": "entitlements.mac.plist",
    "extendInfo": {
      "NSAppleEventsUsageDescription": "Your description here"
    }
  }
}
```

### Linux Specifics

#### Download and Setup
```javascript
// Linux FFmpeg download configuration
const LinuxFFmpegConfig = {
  // John Van Sickle static builds for broad compatibility
  url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  
  // Alternative architectures
  // arm64: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz'
  
  binaryName: 'ffmpeg',
  
  // Requires tar.xz extraction
  extractCommand: 'tar -xf',
};

// Extract using system tar
const { execSync } = require('child_process');

execSync(`tar -xf "${archivePath}" -C "${extractDir}"`);
```

#### Permissions
```javascript
// Grant executable permissions on Linux
fs.chmodSync(ffmpegPath, 0o755);
```

#### Distribution-Specific Packages (Alternative)
Instead of bundling, detect system FFmpeg:

```javascript
const { execSync } = require('child_process');

function detectSystemFFmpeg() {
  try {
    const output = execSync('ffmpeg -version', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return {
      found: true,
      version: output.split('\n')[0],
      path: 'ffmpeg' // Use PATH
    };
  } catch (err) {
    return { found: false };
  }
}

// Prompt user to install if missing
const systemFFmpeg = detectSystemFFmpeg();

if (!systemFFmpeg.found) {
  // Show dialog to install via package manager
  const installCmd = getPlatformInstallCommand(); // Returns based on distro
  showMessage(
    'FFmpeg Required',
    `Please install FFmpeg:\n${installCmd}`,
  );
}
```

Platform-specific install commands:
```javascript
function getPlatformInstallCommand() {
  const distro = detectLinuxDistro();
  
  const commands = {
    ubuntu: 'sudo apt install ffmpeg',
    debian: 'sudo apt install ffmpeg',
    fedora: 'sudo dnf install ffmpeg',
    arch: 'sudo pacman -S ffmpeg',
    centos: 'sudo yum install epel-release && sudo yum install ffmpeg',
  };
  
  return commands[distro] || 'Install FFmpeg using your distribution\'s package manager';
}

function detectLinuxDistro() {
  try {
    const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    if (osRelease.includes('ubuntu')) return 'ubuntu';
    if (osRelease.includes('debian')) return 'debian';
    if (osRelease.includes('fedora')) return 'fedora';
    if (osRelease.includes('arch')) return 'arch';
    if (osRelease.includes('centos')) return 'centos';
  } catch (err) {
    // fallback
  }
  return 'unknown';
}
```

---

## electron-builder Integration

### Configuration Options

#### Using extraResources
Binaries placed outside ASAR, copied to `resources/` directory:

```json
// electron-builder.json
{
  "appId": "com.vod-pipeline.app",
  "productName": "VOD Pipeline",
  "directories": {
    "output": "dist"
  },
  "files": [
    "src/**/*",
    "package.json"
  ],
  "extraResources": [
    {
      "from": "binaries/${os}/",
      "to": "binaries/",
      "filter": ["**/*"]
    }
  ],
  "mac": {
    "target": ["dmg", "zip"],
    "category": "public.app-category.video"
  },
  "win": {
    "target": ["nsis", "portable"]
  },
  "linux": {
    "target": ["AppImage", "deb"]
  }
}
```

Directory structure expected:
```
project/
├── binaries/
│   ├── darwin/
│   │   └── ffmpeg
│   ├── win32/
│   │   └── bin/
│   │       └── ffmpeg.exe
│   └── linux/
│       └── ffmpeg
```

#### Using asarUnpack
Exclude binaries from ASAR archive:

```json
// electron-builder.json OR package.json build config
{
  "asar": true,
  "asarUnpack": [
    "binaries/**/*",
    "node_modules/@ffmpeg-installer/**/*"
  ],
  "extraResources": [
    {
      "from": "binaries/",
      "to": "binaries/"
    }
  ]
}
```

**Important**: If using `asarUnpack`, FFmpeg will be extracted to:
```
/path/to/app/resources/app.asar.unpacked/binaries/
```

### Platform-Specific extraResources

```json
{
  "extraResources": [
    {
      "from": "binaries/${os}/",
      "to": "binaries/"
    }
  ],
  "mac": {
    "extraResources": [
      {
        "from": "binaries/darwin/",
        "to": "binaries/"
      }
    ]
  },
  "win": {
    "extraResources": [
      {
        "from": "binaries/win32/",
        "to": "binaries/"
      }
    ]
  },
  "linux": {
    "extraResources": [
      {
        "from": "binaries/linux/",
        "to": "binaries/"
      }
    ]
  }
}
```

### npm Scripts Integration

```json
{
  "scripts": {
    "postinstall": "node scripts/install-local-ffmpeg.js",
    "build:ffmpeg": "node scripts/download-binaries.js",
    "electron:build": "pnpm run build:ffmpeg && electron-builder",
    "electron:build:win": "pnpm run build:ffmpeg && electron-builder --win",
    "electron:build:mac": "pnpm run build:ffmpeg && electron-builder --mac",
    "electron:build:linux": "pnpm run build:ffmpeg && electron-builder --linux"
  }
}
```

**scripts/download-binaries.js** - Download to binaries/ dir for packaging:

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const binariesBaseDir = path.join(__dirname, '..', 'binaries');

const platformConfigs = {
  darwin: {
    url: 'https://evermeet.cx/ffmpeg/getrelease',
    outputDir: path.join(binariesBaseDir, 'darwin'),
    binaryName: 'ffmpeg',
  },
  win32: {
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    outputDir: path.join(binariesBaseDir, 'win32'),
    binaryName: 'ffmpeg.exe',
    nestedPath: 'bin/ffmpeg.exe', // Inside ZIP
  },
  linux: {
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    outputDir: path.join(binariesBaseDir, 'linux'),
    binaryName: 'ffmpeg',
    nestedPath: null, // Will find automatically
  },
};

// Download for current platform, or all with --all flag
const platformsToDownload = process.argv.includes('--all') 
  ? Object.keys(platformConfigs)
  : [process.platform];

// Download logic similar to install-ffmpeg.js
// ... (implement download and extraction)
```

### Package.json Recommended Config

```json
{
  "name": "vod-pipeline",
  "version": "0.1.0",
  "description": "VOD Pipeline - AI-Assisted Video Editor",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "dev:electron": "concurrently \"pnpm dev\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "vite build && electron-builder",
    "build:ffmpeg": "node scripts/download-binaries.js",
    "postinstall": "node scripts/install-local-ffmpeg.js"
  },
  "dependencies": {
    // app dependencies
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "electron-builder": "^26.0.0",
    "vite": "^6.0.0",
    "unzipper": "^0.12.3"
  },
  "build": {
    "appId": "com.vod-pipeline.app",
    "productName": "VOD Pipeline",
    "directories": {
      "output": "dist"
    },
    "files": [
      "dist/**/*",
      "package.json"
    ],
    "asar": true,
    "asarUnpack": [
      "binaries/**/*"
    ],
    "extraResources": [
      {
        "from": "binaries/",
        "to": "binaries/",
        "filter": ["**/*"]
      }
    ],
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.ico"
    },
    "mac": {
      "target": ["dmg"],
      "icon": "assets/icon.icns",
      "category": "public.app-category.video",
      "hardenedRuntime": true,
      "gatekeeperAssess": false
    },
    "linux": {
      "target": ["AppImage"],
      "icon": "assets/icon.png",
      "category": "Video"
    }
  }
}
```

---

## Runtime FFmpeg Usage

### Path Detection Code

```typescript
// src/electron/ffmpeg-detector.ts
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { app } from 'electron';

interface FFmpegPathResult {
  path: string;
  source: 'bundled' | 'system' | 'user-data';
  version: string;
}

/**
 * Detects FFmpeg location and version
 * Checks in order: bundled → user-data → system PATH → error
 */
export function detectFFmpeg(): FFmpegPathResult | null {
  const platform = process.platform;
  const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  
  // Check 1: Bundled with app (process.resourcesPath)
  const bundledPath = path.join(
    process.resourcesPath, 
    'binaries',
    binaryName
  );
  
  if (fs.existsSync(bundledPath) && isExecutable(bundledPath)) {
    try {
      const version = getFFmpegVersion(bundledPath);
      return {
        path: bundledPath,
        source: 'bundled',
        version,
      };
    } catch (err) {
      console.warn('Bundled FFmpeg found but invalid:', err);
    }
  }
  
  // Check 2: User data directory (downloaded on first run)
  const userDataPath = path.join(
    app.getPath('userData'),
    'binaries',
    binaryName
  );
  
  if (fs.existsSync(userDataPath) && isExecutable(userDataPath)) {
    try {
      const version = getFFmpegVersion(userDataPath);
      return {
        path: userDataPath,
        source: 'user-data',
        version,
      };
    } catch (err) {
      console.warn('User-data FFmpeg found but invalid:', err);
    }
  }
  
  // Check 3: System PATH
  try {
    const systemVersion = getFFmpegVersion('ffmpeg');
    return {
      path: 'ffmpeg', // Will use PATH
      source: 'system',
      version: systemVersion,
    };
  } catch (err) {
    // System FFmpeg not found
  }
  
  // Check 4: Fallback to common install locations
  const commonPaths = getCommonFFmpegPaths(platform);
  for (const testPath of commonPaths) {
    if (fs.existsSync(testPath) && isExecutable(testPath)) {
      try {
        const version = getFFmpegVersion(testPath);
        return {
          path: testPath,
          source: 'system',
          version,
        };
      } catch (err) {
        continue;
      }
    }
  }
  
  return null;
}

function isExecutable(filePath: string): boolean {
  if (process.platform === 'win32') {
    return true; // Windows uses file extension
  }
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function getFFmpegVersion(executablePath: string): string {
  const output = execSync(`"${executablePath}" -version`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const firstLine = output.split('\n')[0];
  return firstLine;
}

function getCommonFFmpegPaths(platform: string): string[] {
  const paths: string[] = [];
  
  if (platform === 'darwin') {
    paths.push(
      '/usr/local/bin/ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
      '/opt/local/bin/ffmpeg',
    );
  } else if (platform === 'linux') {
    paths.push(
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      path.join(process.env.HOME || '', '.local/bin/ffmpeg'),
    );
  } else if (platform === 'win32') {
    paths.push(
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    );
  }
  
  return paths;
}

export default detectFFmpeg;
```

### FFmpeg Path Configuration for FFmpeg Wrapper

```typescript
// src/pipeline/ffmpeg.ts
import { spawn } from 'child_process';
import detectFFmpeg from '../electron/ffmpeg-detector';

let ffmpegPath: string | null = null;

/**
 * Initialize FFmpeg path detection
 * Should be called on app startup
 */
export function initializeFFmpeg(): void {
  const result = detectFFmpeg();
  
  if (!result) {
    throw new Error(
      'FFmpeg not found. Please install FFmpeg or enable the auto-download feature.'
    );
  }
  
  ffmpegPath = result.path;
  console.log(`Using FFmpeg (${result.source}): ${result.version}`);
}

/**
 * Get FFmpeg executable path
 */
export function getFFmpegPath(): string {
  if (!ffmpegPath) {
    throw new Error('FFmpeg not initialized. Call initializeFFmpeg() first.');
  }
  return ffmpegPath;
}

/**
 * Execute FFmpeg command
 */
export async function execFFmpeg(args: string[]): Promise<string> {
  const ffmpeg = getFFmpegPath();
  
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpeg, args);
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}\n${stderr}`));
      }
    });
    
    process.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Get video metadata using FFprobe
 */
export async function getVideoMetadata(videoPath: string) {
  const FFmpeg = getFFmpegPath();
  const ffprobePath = FFmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  
  return new Promise((resolve, reject) => {
    const process = spawn(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ]);
    
    let output = '';
    
    process.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(output));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`FFprobe exited with code ${code}`));
      }
    });
  });
}
```

### Fallback Logic and Error Handling

```typescript
// src/electron/ffmpeg-manager.ts
import path from 'path';
import { app, BrowserWindow, dialog } from 'electron';
import detectFFmpeg from './ffmpeg-detector';
import { downloadAndInstallFFmpeg } from './ffmpeg-installer';

class FFmpegManager {
  private ffmpegPath: string | null = null;
  private mainWindow: BrowserWindow | null = null;
  
  constructor() {
    this.initialize();
  }
  
  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
  }
  
  async initialize(): Promise<boolean> {
    // Try to detect FFmpeg
    const detected = detectFFmpeg();
    
    if (detected) {
      this.ffmpegPath = detected.path;
      console.log(`Using FFmpeg (${detected.source}): ${detected.version}`);
      return true;
    }
    
    // Not found - try auto-install
    console.log('FFmpeg not found. Attempting auto-install...');
    
    try {
      const installedPath = await this.autoInstallFFmpeg();
      this.ffmpegPath = installedPath;
      return true;
    } catch (err) {
      console.error('Auto-install failed:', err);
      this.showFFmpegErrorDialog();
      return false;
    }
  }
  
  async autoInstallFFmpeg(): Promise<string> {
    const userDataPath = path.join(
      app.getPath('userData'),
      'binaries'
    );
    
    // Show download progress to user
    if (this.mainWindow) {
      this.mainWindow.webContents.send('ffmpeg:download:start');
    }
    
    return await downloadAndInstallFFmpeg(
      userDataPath,
      (progress) => {
        if (this.mainWindow) {
          this.mainWindow.webContents.send('ffmpeg:download:progress', progress);
        }
      }
    );
  }
  
  showFFmpegErrorDialog(): void {
    const message =
      'FFmpeg is required for video processing but could not be found.\n\n' +
      'Options:\n' +
      '1. Install FFmpeg manually\n' +
      '   Windows: https://www.gyan.dev/ffmpeg/builds/\n' +
      '   macOS: ffmpeg via brew\n' +
      '   Linux: use system package manager\n\n' +
      '2. Enable auto-download (requires internet connection)\n\n' +
      'The application will continue but video features will be disabled.';
    
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'FFmpeg Not Found',
      message,
      buttons: ['OK'],
    });
  }
  
  getPath(): string {
    if (!this.ffmpegPath) {
      throw new Error('FFmpeg not available. Run initialize() first.');
    }
    return this.ffmpegPath;
  }
  
  isAvailable(): boolean {
    return this.ffmpegPath !== null;
  }
}

export const ffmpegManager = new FFmpegManager();
```

### Version Checking

```typescript
// Check for minimum FFmpeg version
export function checkFFmpegVersion(versionString: string, minVersion: string): boolean {
  // Parse version: "ffmpeg version 8.0.1 Copyright..."
  const match = versionString.match(/ffmpeg version (\d+\.\d+\.\d+)/);
  
  if (!match) {
    console.warn('Could not parse FFmpeg version');
    return false;
  }
  
  const installedVersion = match[1];
  
  const [major1, minor1, patch1] = installedVersion.split('.').map(Number);
  const [major2, minor2, patch2] = minVersion.split('.').map(Number);
  
  // Compare major, then minor, then patch
  if (major1 > major2) return true;
  if (major1 < major2) return false;
  
  if (minor1 > minor2) return true;
  if (minor1 < minor2) return false;
  
  return patch1 >= patch2;
}

// Usage
const MIN_FFMPEG_VERSION = '5.0.0'; // FFmpeg 5.0+ for certain features

const result = detectFFmpeg();
if (result) {
  const isSupported = checkFFmpegVersion(result.version, MIN_FFMPEG_VERSION);
  if (!isSupported) {
    console.warn(`FFmpeg version ${result.version} is below minimum ${MIN_FFMPEG_VERSION}`);
  }
}
```

### Runtime Download Implementation

```typescript
// src/electron/ffmpeg-installer.ts
import https from 'https';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import unzip from 'unzipper';

interface ProgressCallback {
  (progress: { percent: number; downloaded: number; total: number }): void;
}

async function downloadAndInstallFFmpeg(
  installDir: string,
  onProgress?: ProgressCallback
): Promise<string> {
  const platform = process.platform;
  
  const configs = {
    darwin: {
      url: 'https://evermeet.cx/ffmpeg/getrelease',
      binaryName: 'ffmpeg',
    },
    win32: {
      url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
      binaryName: 'ffmpeg.exe',
      extractNested: true,
      nestedPath: 'bin',
    },
    linux: {
      url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      binaryName: 'ffmpeg',
      usesTar: true,
    },
  };
  
  const config = configs[platform as keyof typeof configs];
  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  
  await fs.promises.mkdir(installDir, { recursive: true });
  
  // Download
  const archivePath = path.join(installDir, path.basename(config.url));
  await downloadWithProgress(config.url, archivePath, onProgress);
  
  // Extract
  await extractArchive(archivePath, installDir, config);
  
  // Find and move binary
  let binaryPath = path.join(installDir, config.binaryName);
  
  if (config.extractNested || config.usesTar) {
    const extractedBinary = await findExtractedBinary(installDir, config.binaryName);
    if (extractedBinary !== binaryPath) {
      await fs.promises.copyFile(extractedBinary, binaryPath);
      
      // Make executable on *nix
      if (platform !== 'win32') {
        await fs.promises.chmod(binaryPath, 0o755);
      }
    }
  }
  
  // Cleanup archive and temp directories
  await cleanup(installDir);
  
  // Return path
  return binaryPath;
}

async function downloadWithProgress(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      // Follow redirects
      if (response.statusCode === 302 || response.statusCode === 301) {
        return downloadWithProgress(
          response.headers.location!,
          destPath,
          onProgress
        ).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }
      
      const total = parseInt(response.headers['content-length'] || '0', 10);
      const fileStream = fs.createWriteStream(destPath);
      
      response.on('data', (chunk) => {
        if (onProgress && total > 0) {
          const downloaded = fileStream.bytesWritten;
          onProgress({
            percent: (downloaded / total) * 100,
            downloaded,
            total,
          });
        }
      });
      
      pipeline(response, fileStream)
        .then(() => resolve())
        .catch(reject);
    }).on('error', reject);
  });
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  config: any
): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    await fs.createReadStream(archivePath)
      .pipe(unzip.Extract({ path: destDir }))
      .promise();
  } else if (archivePath.endsWith('.tar.xz')) {
    const extractDir = path.join(destDir, 'temp_extract');
    await fs.promises.mkdir(extractDir, { recursive: true });
    
    execSync(`tar -xf "${archivePath}" -C "${extractDir}"`, {
      stdio: 'ignore',
    });
  }
}

async function findExtractedBinary(dir: string, binaryName: string): Promise<string> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const found = await findExtractedBinary(fullPath, binaryName);
      if (found && fs.existsSync(found)) {
        return found;
      }
    } else if (entry.name === binaryName) {
      return fullPath;
    }
  }
  
  throw new Error(`Could not find ${binaryName} in ${dir}`);
}

async function cleanup(installDir: string): Promise<void> {
  const entries = await fs.promises.readdir(installDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'bin') continue;
    
    const fullPath = path.join(installDir, entry.name);
    // Remove temp directories
    await fs.promises.rm(fullPath, { recursive: true, force: true });
  }
}

export { downloadAndInstallFFmpeg };
```

---

## Summary and Recommendations

### Recommended Approach for VOD Pipeline

Given the project requirements (local-first, video processing, cross-platform):

1. **Development**: Use postinstall script to download FFmpeg to project root `binaries/` dir
2. **Packaging**: Use `extraResources` in electron-builder to include pre-downloaded binaries
3. **Fallback**: Implement runtime download+install to user data directory if bundled binary missing
4. **Detection**: Check locations in order: bundled → user-data → system PATH

### File Structure
```
vod-pipeline/
├── scripts/
│   ├── install-local-ffmpeg.js  (Dev: download to binaries/)
│   └── download-binaries.js     (CI: download all platforms)
├── binaries/
│   ├── darwin/
│   │   └── ffmpeg
│   ├── win32/
│   │   └── bin/
│   │       └── ffmpeg.exe
│   └── linux/
│       └── ffmpeg
├── src/
│   ├── electron/
│   │   ├── ffmpeg-detector.ts   (Path detection)
│   │   ├── ffmpeg-installer.ts  (Runtime install)
│   │   └── main.ts              (Initialization)
│   └── pipeline/
│       └── ffmpeg.ts            (FFmpeg wrapper)
└── package.json
    └── scripts:
        postinstall: node ./scripts/install-local-ffmpeg.js
```

### License Considerations
- FFmpeg static builds are **GPLv3** licensed
- If you distribute FFmpeg with your app, you must:
  - Provide source code on request (or link to FFmpeg source)
  - Include a GPLv3 notice in your app
  - Your own code that dynamically links to FFmpeg is **not** under GPL (child_process exec is safe)
  - If using `@ffmpeg-installer/ffmpeg`, it handles this for you

- **Alternative**: Point users to install FFmpeg themselves (simpler distribution, no licensing concerns)

### Complete Example Integration

See the code examples above for:
- `scripts/install-local-ffmpeg.js` - Postinstall implementation
- `src/electron/ffmpeg-detector.ts` - Path detection
- `src/electron/ffmpeg-installer.ts` - Runtime install
- `src/pipeline/ffmpeg.ts` - FFmpeg wrapper with path config
- `package.json` - electron-builder and scripts config
