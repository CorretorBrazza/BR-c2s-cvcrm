import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Build do service worker (ESM).
 * Saída fixa: dist/background/serviceWorker.js
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    outDir: 'dist/background',
    emptyOutDir: false,
    target: 'chrome116',
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(root, 'src/background/serviceWorker.ts'),
      formats: ['es'],
      fileName: () => 'serviceWorker.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
