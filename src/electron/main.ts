import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerIpcHandlers } from './ipc/handlers';
import { initializeDatabase, closeDatabase } from './database/db';
import { getAgentBridge } from './agent-bridge.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let agentBridge: ReturnType<typeof getAgentBridge> | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      console.error('Renderer build not found. Please run `pnpm build` first.');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  console.log('Electron app starting...');
  console.log('Platform:', process.platform);
  console.log('Node version:', process.version);
  console.log('Electron version:', process.versions.electron);
  console.log('Development mode:', process.env.NODE_ENV !== 'production');

  initializeDatabase();
  registerIpcHandlers();
  createWindow();

  await startAgentBridge();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  initializeFFmpeg();
});

async function startAgentBridge() {
  try {
    console.log('[Main] Starting agent bridge...');
    agentBridge = getAgentBridge();
    await agentBridge.start();

    agentBridge.on('stream', (message: any) => {
      mainWindow?.webContents.send('agent:stream', message);
    });

    agentBridge.on('error', (error: Error) => {
      console.error('[Main] Agent bridge error:', error);
      mainWindow?.webContents.send('agent:error', { error: error.message });
    });

    agentBridge.on('exit', (code: number, signal: string) => {
      console.log(`[Main] Agent bridge exited: ${code} (${signal})`);
    });

    console.log('[Main] Agent bridge started successfully');
  } catch (error) {
    console.error('[Main] Failed to start agent bridge:', error);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  console.log('App is quitting...');
  closeDatabase();

  if (agentBridge) {
    console.log('[Main] Stopping agent bridge...');
    await agentBridge.stop();
  }
});

function initializeFFmpeg() {
  console.log('Initializing FFmpeg...');

  const ffmpegPath = detectFFmpeg();
  if (ffmpegPath) {
    console.log(`FFmpeg found at: ${ffmpegPath}`);
  } else {
    console.warn('FFmpeg not found. Video processing features will be disabled.');
    console.warn('Install FFmpeg or run the installer script.');
  }
}

function detectFFmpeg(): string | null {
  const platform = process.platform;
  const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const resourcesPath = process.resourcesPath || process.cwd();

  const platformPath = (PLATFORM_CONFIG as Record<string, { path: string }>)[platform]?.path || '';

  const possiblePaths = [
    path.join(resourcesPath, 'binaries', platformPath, binaryName),
    path.join(process.cwd(), 'binaries', platform, binaryName),
    path.join(app.getPath('userData'), 'binaries', binaryName),
    binaryName,
  ];

  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      return testPath;
    }
  }

  return null;
}

const PLATFORM_CONFIG: Record<string, { path: string }> = {
  win32: { path: '' },
  darwin: { path: '' },
  linux: { path: '' },
  aix: { path: '' },
  freebsd: { path: '' },
  openbsd: { path: '' },
  sunos: { path: '' },
};
