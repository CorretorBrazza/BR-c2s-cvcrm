import { build, loadEnv } from 'vite';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
process.chdir(root);

function fail(message) {
  console.error(`[build] FALHOU: ${message}`);
  process.exit(1);
}

function run(configFile) {
  return build({ configFile, mode: 'production', logLevel: 'info' });
}

const env = (() => {
  const fromFiles = loadEnv('production', root, '');
  const merged = { ...fromFiles };
  // Vite expõe também variáveis do processo; o guard precisa ver o mesmo valor
  // que o bundler verá (útil em CI, onde nada é escrito em `.env`).
  for (const chave of ['VITE_AUTOMATION_ENABLED', 'VITE_LICENSE_PUBLIC_KEY', 'VITE_APP_ENV']) {
    if (process.env[chave] !== undefined) merged[chave] = process.env[chave];
  }
  return merged;
})();
const automationEnabled = env.VITE_AUTOMATION_ENABLED === 'true';
const rawKey = (env.VITE_LICENSE_PUBLIC_KEY ?? '').trim();
const keyBody = rawKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

/**
 * Um build que promete automação sem chave pública gera um pacote que recusa
 * toda licença e nunca age — foi exatamente o estado encontrado em `dist/`.
 * Aqui isso vira erro de build, não surpresa em produção.
 */
function validateEnv() {
  if (!automationEnabled) return;

  if (!rawKey) {
    fail(
      'VITE_AUTOMATION_ENABLED=true sem VITE_LICENSE_PUBLIC_KEY. ' +
        'Sem a chave, o actionGuard nega toda ação (licença inválida) e o build sai inútil. ' +
        'Gere as chaves com: node scripts/license.mjs keygen',
    );
  }
  if (/\r?\n/.test(rawKey)) {
    fail(
      'VITE_LICENSE_PUBLIC_KEY tem quebra de linha. Em `.env` use a forma raw base64 (44 caracteres, uma linha) ' +
        'impressa por "node scripts/license.mjs keygen".',
    );
  }
  if (keyBody.length < 32) {
    fail(`VITE_LICENSE_PUBLIC_KEY parece curta demais (${keyBody.length} caracteres úteis).`);
  }
}

/** Prova que a chave realmente entrou nos bundles que a usam. */
function verifyKeyEmbedded() {
  if (!rawKey) return;
  const fingerprint = keyBody.slice(-16);
  const alvos = ['dist/background/serviceWorker.js'];
  for (const file of alvos) {
    const caminho = resolve(root, file);
    if (!existsSync(caminho)) fail(`arquivo esperado ausente: ${file}`);
    const conteudo = readFileSync(caminho, 'utf8');
    if (!conteudo.includes(fingerprint)) {
      fail(
        `a chave pública não foi embutida em ${file}. ` +
          'Confira se a variável está no `.env` na raiz do projeto (não em .env.local de outro diretório).',
      );
    }
  }
}

/** Prova que a flag de automação sobreviveu à minificação. */
function verifyAutomationFlag() {
  const conteudo = readFileSync(resolve(root, 'dist/background/serviceWorker.js'), 'utf8');
  const esperada = automationEnabled ? 'c2s:automation=on' : 'c2s:automation=off';
  const proibida = automationEnabled ? 'c2s:automation=off' : 'c2s:automation=on';

  if (!conteudo.includes(esperada)) {
    fail(
      `o bundle não contém a marca "${esperada}". ` +
        'A flag de automação não chegou ao pacote — verifique o .env e apague dist/ antes de rebuildar.',
    );
  }
  if (conteudo.includes(proibida)) {
    fail(
      `o bundle contém a marca oposta ("${proibida}"), sinal de artefato antigo. ` +
        'Rode "npm run clean" e refaça o build.',
    );
  }
}

function writeBuildInfo() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const info = {
    nome: pkg.name,
    versao: pkg.version,
    geradoEm: new Date().toISOString(),
    automacaoNoBuild: automationEnabled,
    chaveDeLicenca: rawKey ? (rawKey.includes('BEGIN PUBLIC KEY') ? 'pem' : 'raw32') : 'ausente',
    ambiente: env.VITE_APP_ENV ?? 'production',
  };
  writeFileSync(resolve(root, 'dist/build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

async function main() {
  console.log(
    `[build] automação: ${automationEnabled ? 'LIGADA' : 'desligada'} · licença: ${
      rawKey ? 'chave presente' : 'sem chave pública'
    }`,
  );
  if (automationEnabled) {
    console.log(
      '[build] lembrete: as ações também dependem de opt-in, calibração confirmada e das chaves nas Configurações.',
    );
  }
  validateEnv();

  console.log('[build] 1/4 painel (React)');
  await run('vite.config.ts');

  console.log('[build] 2/4 service worker');
  await run('vite.background.config.ts');

  console.log('[build] 3/4 content script (ISOLATED)');
  process.env.C2S_ENTRY = 'index';
  await run('vite.content.config.ts');

  console.log('[build] 4/4 interceptor (MAIN world)');
  process.env.C2S_ENTRY = 'interceptor';
  await run('vite.content.config.ts');
  delete process.env.C2S_ENTRY;

  console.log('[build] 5/6 CV CRM content (ISOLATED)');
  process.env.C2S_ENTRY = 'cvcrm';
  await run('vite.content.config.ts');

  console.log('[build] 6/6 CV CRM guard do confirm (MAIN world)');
  process.env.C2S_ENTRY = 'cvcrm-guard';
  await run('vite.content.config.ts');
  delete process.env.C2S_ENTRY;

  const required = [
    'dist/manifest.json',
    'dist/panel.html',
    'dist/background/serviceWorker.js',
    'dist/content/index.js',
    'dist/content/interceptor.js',
    'dist/content/cvcrm.js',
    'dist/content/cvcrm-guard.js',
    'dist/icons/icon-16.png',
    'dist/icons/icon-32.png',
    'dist/icons/icon-48.png',
    'dist/icons/icon-128.png',
  ];

  const missing = required.filter((file) => !existsSync(resolve(root, file)));
  if (missing.length > 0) {
    console.error('[build] FALHOU. Arquivos ausentes:');
    for (const file of missing) console.error('  - ' + file);
    process.exit(1);
  }

  verifyKeyEmbedded();
  verifyAutomationFlag();
  const info = writeBuildInfo();

  for (const file of required) {
    const size = statSync(resolve(root, file)).size;
    console.log(`[build] ok ${file} (${size} bytes)`);
  }

  const painel = readdirSync(resolve(root, 'dist/assets')).filter((name) => name.startsWith('panel-'));
  console.log(`[build] painel: ${painel.join(', ') || 'ausente'}`);
  console.log(
    `[build] build-info: automação=${info.automacaoNoBuild ? 'ligada' : 'desligada'} licença=${info.chaveDeLicenca}`,
  );
  console.log('[build] concluido -> dist/');
}

main().catch((error) => {
  console.error('[build] erro fatal', error);
  process.exit(1);
});
