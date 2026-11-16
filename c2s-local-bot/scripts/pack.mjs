import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
process.chdir(root);

if (!existsSync('dist/manifest.json')) {
  console.error('[pack] dist/ nao encontrado. Rode "npm run build" primeiro.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('release', { recursive: true });
const out = resolve('release', `c2s-local-bot-v${pkg.version}.zip`);

const isWindows = process.platform === 'win32';
const result = isWindows
  ? spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Compress-Archive -Path dist\\* -DestinationPath "${out}" -Force`],
      { stdio: 'inherit' },
    )
  : spawnSync('zip', ['-r', out, '.'], { cwd: resolve('dist'), stdio: 'inherit' });

if (result.status !== 0) {
  console.error('[pack] falhou');
  process.exit(result.status ?? 1);
}
console.log('[pack] ok ->', out);
