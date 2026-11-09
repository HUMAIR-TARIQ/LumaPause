import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const electronBinary = require('electron');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'warning',
  legalComments: 'none',
};

let electronProcess = null;
let restartTimer = null;
let shuttingDown = false;
let firstBuildDone = false;

function onRebuild(label) {
  return {
    name: `restart-on-${label}`,
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          console.error(`[dev] ${label} build failed; keeping the current app.`);
          return;
        }
        if (!firstBuildDone) return;
        scheduleRestart(`${label} changed`);
      });
    },
  };
}

function scheduleRestart(reason) {
  if (shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log(`[dev] restarting Electron (${reason})`);
    stopElectron();
    startElectron();
  }, 250);
}

function stopElectron() {
  const processToStop = electronProcess;
  electronProcess = null;
  if (processToStop && !processToStop.killed) {
    try {
      processToStop.kill();
    } catch {
      /* already gone */
    }
  }
}

function startElectron() {
  if (shuttingDown) return;
  const electronEnv = {
    ...process.env,
    NODE_ENV: 'development',
    LUMAPAUSE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
  };
  // Some agent and CI terminals set this globally. Passing it to Electron
  // makes electron.exe run as plain Node and breaks the `electron` builtin.
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const nextElectronProcess = spawn(electronBinary, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: electronEnv,
  });
  electronProcess = nextElectronProcess;
  nextElectronProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[dev] Electron exited with code ${code ?? 'null'}. Waiting for changes.`);
      if (electronProcess === nextElectronProcess) electronProcess = null;
    }
  });
}

async function waitForVite(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

async function assertPortAvailable(port) {
  await new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        rejectPort(
          new Error(
            `Port ${port} is already in use. Another LumaPause dev session may still be running. ` +
              'Stop it with Ctrl+C before starting a new one.',
          ),
        );
        return;
      }
      rejectPort(error);
    });
    probe.listen({ host: '127.0.0.1', port }, () => {
      probe.close(resolvePort);
    });
  });
}

await assertPortAvailable(5173);

const mainContext = await context({
  ...shared,
  entryPoints: [resolve(root, 'src/main/main.ts')],
  outfile: resolve(root, 'out/main/main.js'),
  format: 'esm',
  packages: 'external',
  plugins: [onRebuild('main')],
});

const preloadContext = await context({
  ...shared,
  entryPoints: [resolve(root, 'src/preload/index.ts')],
  outfile: resolve(root, 'out/preload/index.cjs'),
  format: 'cjs',
  external: ['electron'],
  plugins: [onRebuild('preload')],
});

await mainContext.rebuild();
await preloadContext.rebuild();
await mainContext.watch();
await preloadContext.watch();

// Launch Vite directly with Node. On Windows, spawning `npx.cmd` through a shell
// creates an extra cmd.exe process; killing it can leave the Vite child orphaned
// and holding port 5173 after the dev orchestrator exits.
const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js');
const vite = spawn(
  process.execPath,
  [viteEntry, '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  },
);

vite.on('exit', (code) => {
  if (!shuttingDown && code !== 0) {
    console.error(`[dev] Vite exited with code ${code}.`);
    shutdown(1);
  }
});

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  stopElectron();
  try {
    vite.kill();
  } catch {
    /* gone */
  }
  Promise.allSettled([mainContext.dispose(), preloadContext.dispose()]).finally(() => {
    process.exit(code);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await waitForVite('http://127.0.0.1:5173');
firstBuildDone = true;
console.log('[dev] Vite ready. Starting Electron.');
startElectron();
