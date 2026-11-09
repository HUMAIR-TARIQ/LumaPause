import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { contentSecurityPolicy } from './src/shared/csp';

const root = dirname(fileURLToPath(import.meta.url));

function cspPlugin(): Plugin {
  return {
    name: 'lumapause-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        // The Electron main process also sends this policy as a response
        // header. The meta tag keeps the static file safe on its own.
        const policy = contentSecurityPolicy(Boolean(context.server), true);
        return html.replace(
          '<!-- LUMAPAUSE_CSP -->',
          `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), cspPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  worker: {
    // Classic workers load reliably from the packaged file:// renderer.
    format: 'iife',
  },
  build: {
    outDir: resolve(root, 'out/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
