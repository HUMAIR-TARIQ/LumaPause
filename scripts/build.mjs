import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
};

await build({
  ...shared,
  entryPoints: [resolve(root, 'src/main/main.ts')],
  outfile: resolve(root, 'out/main/main.js'),
  format: 'esm',
  packages: 'external',
});

await build({
  ...shared,
  entryPoints: [resolve(root, 'src/preload/index.ts')],
  outfile: resolve(root, 'out/preload/index.cjs'),
  format: 'cjs',
  external: ['electron'],
});

const viteBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const vite = spawnSync(viteBin, ['vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, NODE_ENV: 'production' },
});

if (vite.status !== 0) {
  process.exit(vite.status ?? 1);
}

console.log('\nLumaPause build complete: out/main, out/preload, out/renderer');
