import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

const localPath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// A browser-only entry keeps Pages independent of the local Vinext server.
export default defineConfig({
  root: localPath('./static'),
  base: '/mechanical-computer-lab/',
  publicDir: localPath('./public'),
  resolve: { alias: { '@': localPath('./') } },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: localPath('./dist-pages'),
    emptyOutDir: true,
  },
});
