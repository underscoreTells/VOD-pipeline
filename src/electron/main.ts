import { app } from 'electron';
import { startAgentRuntime, stopAgentRuntime } from './bootstrap/agent-runtime.js';
import { registerAppLifecycleHandlers } from './bootstrap/app-lifecycle.js';
import { initializeDependencies } from './bootstrap/dependencies.js';
import { loadEnvironment } from './bootstrap/env.js';
import { createMainWindow, getMainWindow } from './bootstrap/window.js';
import { initializeDatabase, closeDatabase } from './database/index.js';
import { initializeDevRuntimeState } from './dev-runtime.js';
import { registerIpcHandlers } from './ipc/register.js';
import { createLogger } from './logger.js';
import { registerMediaProtocol, registerMediaProtocolScheme } from './media-protocol.js';

const logger = createLogger('Main');
const isDevelopment = process.env.NODE_ENV !== 'production';

loadEnvironment();
registerMediaProtocolScheme();

// Linux dev environments can fail hard when Chromium's GPU process is unavailable.
if (process.platform === 'linux' && isDevelopment) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

app.whenReady().then(async () => {
  logger.info('Electron app starting...');
  logger.info('Platform:', process.platform);
  logger.info('Node version:', process.version);
  logger.info('Electron version:', process.versions.electron);
  logger.info('Development mode:', isDevelopment);

  await initializeDatabase();
  await initializeDevRuntimeState();
  registerIpcHandlers();
  registerMediaProtocol();
  await initializeDependencies();
  createMainWindow();
  await startAgentRuntime(getMainWindow);

  registerAppLifecycleHandlers({
    createWindow: createMainWindow,
    beforeQuit: async () => {
      logger.info('App is quitting...');
      closeDatabase();
      await stopAgentRuntime();
    },
  });
}).catch((error) => {
  logger.error('Failed during Electron bootstrap:', error);
});

export { getMainWindow } from './bootstrap/window.js';
