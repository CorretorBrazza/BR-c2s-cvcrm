import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Build do painel (React). É o primeiro build: limpa dist/ e copia public/.
 * Saída: dist/panel.html + dist/assets/* + dist/manifest.json + dist/icons/*
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: false,
    rollupOptions: {
      input: { panel: resolve(root, 'panel.html') },
    },
  },
});
