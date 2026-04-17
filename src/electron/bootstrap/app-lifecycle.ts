import { app, BrowserWindow } from 'electron';
import { createLogger } from '../logger.js';

const logger = createLogger('Lifecycle');

interface LifecycleHandlers {
  createWindow: () => BrowserWindow;
  beforeQuit: () => Promise<void>;
}

export function registerAppLifecycleHandlers(handlers: LifecycleHandlers): void {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      handlers.createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    void handlers.beforeQuit().catch((error) => {
      logger.error('before-quit handler failed:', error);
    });
  });
}
