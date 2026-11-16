import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Build dos content scripts (IIFE — content scripts do MV3 não aceitam ESM).
 *
 * C2S_ENTRY=index         -> dist/content/index.js        (C2S, ISOLATED)
 * C2S_ENTRY=interceptor   -> dist/content/interceptor.js  (C2S, MAIN world)
 * C2S_ENTRY=cvcrm         -> dist/content/cvcrm.js        (CV CRM, ISOLATED)
 * C2S_ENTRY=cvcrm-guard   -> dist/content/cvcrm-guard.js  (CV CRM, MAIN world)
 */
const ENTRIES = {
  index: {
    src: 'src/content/index.ts',
    name: 'C2SBotContent',
    out: 'index.js',
  },
  interceptor: {
    src: 'src/content/injected/interceptor.ts',
    name: 'C2SBotInterceptor',
    out: 'interceptor.js',
  },
  cvcrm: {
    src: 'src/content/cvcrm/index.ts',
    name: 'C2SCvContent',
    out: 'cvcrm.js',
  },
  'cvcrm-guard': {
    src: 'src/content/cvcrm/injected/confirmArm.ts',
    name: 'C2SCvGuard',
    out: 'cvcrm-guard.js',
  },
} as const;

type EntryKey = keyof typeof ENTRIES;

const requested = (process.env.C2S_ENTRY ?? 'index') as EntryKey;
const entry = ENTRIES[requested] ?? ENTRIES.index;

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    outDir: 'dist/content',
    emptyOutDir: false,
    target: 'chrome116',
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(root, entry.src),
      formats: ['iife'],
      name: entry.name,
      fileName: () => entry.out,
    },
  },
});
