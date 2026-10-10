import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));
const { version } = JSON.parse(
  readFileSync(fromRoot('./package.json'), 'utf8'),
) as { version: string };

// Plain single-page app: everything, including physics, runs in the browser.
// BASE_PATH=/mechanical-computer-lab/ builds for GitHub Pages.
export default defineConfig({
  root: fromRoot('./app'),
  base: process.env.BASE_PATH ?? '/',
  publicDir: fromRoot('./public'),
  // Stamped into downloaded browser reports.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    {
      // machines/ lives outside the app root; watch it so a newly added preset
      // (e.g. machines/reference-adder.machine.json) appears without a restart.
      name: 'watch-machines',
      configureServer(server) {
        server.watcher.add(fromRoot('./machines'));
      },
    },
  ],
  worker: { format: 'es' },
  build: {
    outDir: fromRoot('./dist'),
    emptyOutDir: true,
    // three.js (page) and Rapier's inlined WebAssembly (worker) are large by
    // nature; both load locally with no third-party requests.
    chunkSizeWarningLimit: 2600,
  },
  server: { host: '127.0.0.1', port: 3018, strictPort: true },
  preview: { host: '127.0.0.1', port: 3018, strictPort: true },
});
