import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../logger.js';

const logger = createLogger('Window');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const isDev = process.env.NODE_ENV !== 'production';
  const preloadPath = path.join(__dirname, '..', 'preload.cjs');

  logger.debug('Preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();
  }

  mainWindow.webContents.on('preload-error', (_event, failingPreloadPath, error) => {
    logger.error(`Failed to load preload ${failingPreloadPath}:`, error);
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      const levelName = ['debug', 'info', 'warning', 'error'][level] ?? String(level);
      logger.debug(`Renderer ${levelName}: ${message}`);
    });
  }

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
    if (process.env.ELECTRON_OPEN_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    const indexPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
    if (fs.existsSync(indexPath)) {
      void mainWindow.loadFile(indexPath);
    } else {
      logger.error('Renderer build not found. Please run `pnpm build` first.');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
