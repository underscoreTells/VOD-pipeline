import net from 'node:net';
import { spawn } from 'node:child_process';

const requestedPort = Number.parseInt(process.env.VITE_DEV_SERVER_PORT ?? '5173', 10);
const startingPort = Number.isNaN(requestedPort) ? 5173 : requestedPort;
const port = await findAvailablePort(startingPort);
const devServerUrl = `http://localhost:${port}`;
const env = {
  ...process.env,
  VITE_DEV_SERVER_PORT: String(port),
  VITE_DEV_SERVER_URL: devServerUrl,
};
const childProcesses = new Set();
let shuttingDown = false;
let resolveKeepAlive;
const keepAlive = new Promise((resolve) => {
  resolveKeepAlive = resolve;
});

if (port !== startingPort) {
  console.warn(`Port ${startingPort} is unavailable, using ${port} for the renderer dev server.`);
}

await runCommand('pnpm', ['setup:dev'], env);

const rendererProcess = startManagedProcess('renderer', 'pnpm', ['dev:renderer'], env);

try {
  await runCommand('pnpm', ['exec', 'wait-on', devServerUrl], env);
} catch (error) {
  terminateChildren();
  throw error;
}

if (rendererProcess.exitCode !== null) {
  terminateChildren();
  throw new Error('Renderer exited before the dev server became ready.');
}

startManagedProcess('electron', 'pnpm', ['dev:electron'], env);
registerShutdownHandlers();
await keepAlive;

function startManagedProcess(name, command, args, childEnv) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: childEnv,
  });

  childProcesses.add(child);

  child.on('exit', (code, signal) => {
    childProcesses.delete(child);
    handleManagedProcessExit(name, code, signal);
  });

  child.on('error', (error) => {
    childProcesses.delete(child);

    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    terminateChildren();
    console.error(`Failed to start ${name}:`, error);
    process.exit(1);
  });

  return child;
}

function handleManagedProcessExit(name, code, signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  terminateChildren();

  if (signal) {
    resolveKeepAlive();
    process.exit(getSignalExitCode(signal));
    return;
  }

  const exitCode = code ?? 0;
  if (exitCode !== 0) {
    console.error(`${name} exited with code ${exitCode}`);
  }

  resolveKeepAlive();
  process.exit(exitCode);
}

function terminateChildren() {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}

function runCommand(command, args, childEnv) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: childEnv,
  });

  return new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      if ((code ?? 0) === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 0}`));
    });
  });
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (portToTry) => {
      const server = net.createServer();

      server.once('error', (error) => {
        server.close();
        if (isAddressInUse(error)) {
          tryPort(portToTry + 1);
          return;
        }

        reject(error);
      });

      server.once('listening', () => {
        server.close(() => resolve(portToTry));
      });

      server.listen(portToTry, '127.0.0.1');
    };

    tryPort(startPort);
  });
}

function isAddressInUse(error) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE';
}

function registerShutdownHandlers() {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

  for (const signal of signals) {
    process.on(signal, () => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      terminateChildren();
      resolveKeepAlive();
    });
  }
}

function getSignalExitCode(signal) {
  switch (signal) {
    case 'SIGHUP':
      return 129;
    case 'SIGINT':
      return 130;
    case 'SIGTERM':
      return 143;
    default:
      return 1;
  }
}
