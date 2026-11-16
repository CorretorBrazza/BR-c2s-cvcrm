#!/usr/bin/env node
/**
 * Utilitário de licenças offline (Ed25519).
 *
 * NÃO faz parte da extensão: roda apenas na máquina de quem emite a licença.
 * A chave privada nunca deve ser versionada nem copiada para o build.
 *
 * Uso:
 *   node scripts/license.mjs keygen [--dir .] [--force]
 *   node scripts/license.mjs sign --customer "Nome" [--plan pro] [--days 365]
 *        [--features bucketCapture,autoStatus] [--dir .] [--out arquivo.lic]
 *   node scripts/license.mjs verify --license arquivo.lic [--public license-public.pem]
 *
 * A assinatura cobre os bytes ASCII da string `payload` (base64url), exatamente
 * como o licenseService valida no navegador.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FEATURES = ['bucketCapture', 'autoStatus', 'autoActivity', 'autoMessage', 'metrics'];
const PLANS = ['trial', 'pro', 'enterprise'];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function fail(message) {
  console.error(`[licenca] erro: ${message}`);
  process.exit(1);
}

function rawPublicKeyFromPem(pem) {
  const key = createPublicKey(pem);
  const der = key.export({ type: 'spki', format: 'der' });
  // SPKI Ed25519: cabeçalho de 12 bytes + 32 bytes de chave.
  const raw = der.subarray(der.length - 32);
  if (raw.length !== 32) fail('chave pública exportada não tem 32 bytes.');
  return raw.toString('base64');
}

function keygen(args) {
  const dir = resolve(typeof args.dir === 'string' ? args.dir : '.');
  const privPath = join(dir, 'license-private.pem');
  const pubPath = join(dir, 'license-public.pem');

  if (!args.force && (existsSync(privPath) || existsSync(pubPath))) {
    fail(`já existe chave em ${dir}. Use --force para sobrescrever.`);
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

  writeFileSync(privPath, privPem, { mode: 0o600 });
  writeFileSync(pubPath, pubPem);

  console.log('[licenca] chave privada:', privPath);
  console.log('[licenca] chave pública:', pubPath);
  console.log('[licenca] VITE_LICENSE_PUBLIC_KEY (PEM):');
  console.log(pubPem.trim());
  console.log('[licenca] alternativa raw base64 (32 bytes):');
  console.log(rawPublicKeyFromPem(pubPem));
}

function signLicense(args) {
  const dir = resolve(typeof args.dir === 'string' ? args.dir : '.');
  const privPath = join(dir, 'license-private.pem');
  if (!existsSync(privPath)) fail(`não encontrei ${privPath}. Rode "keygen" primeiro.`);

  const customer = typeof args.customer === 'string' ? args.customer.trim() : '';
  if (!customer) fail('informe --customer "Nome do cliente".');

  const plan = typeof args.plan === 'string' ? args.plan : 'pro';
  if (!PLANS.includes(plan)) fail(`--plan deve ser um de: ${PLANS.join(', ')}.`);

  const days = Number(args.days ?? 365);
  if (!Number.isFinite(days) || days <= 0) fail('--days deve ser um número positivo.');

  const requested = typeof args.features === 'string'
    ? args.features.split(',').map((item) => item.trim()).filter(Boolean)
    : FEATURES;
  const unknown = requested.filter((item) => !FEATURES.includes(item));
  if (unknown.length > 0) fail(`recursos desconhecidos: ${unknown.join(', ')}.`);

  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  const payload = {
    customer,
    plan,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    licenseId: `lic-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    features: Object.fromEntries(FEATURES.map((feature) => [feature, requested.includes(feature)])),
  };

  const payloadText = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const privateKey = createPrivateKey(readFileSync(privPath));
  const signature = sign(null, Buffer.from(payloadText, 'ascii'), privateKey).toString('base64url');

  const license = { payload: payloadText, signature, alg: 'Ed25519' };
  const out = resolve(dir, typeof args.out === 'string' ? args.out : 'c2s-license.lic');
  writeFileSync(out, `${JSON.stringify(license, null, 2)}\n`);

  console.log('[licenca] arquivo:', out);
  console.log('[licenca] cliente:', payload.customer);
  console.log('[licenca] plano:', payload.plan);
  console.log('[licenca] validade:', payload.expiresAt);
  console.log('[licenca] recursos:', requested.join(', ') || '(nenhum)');
}

function verifyLicense(args) {
  const dir = resolve(typeof args.dir === 'string' ? args.dir : '.');
  const licensePath = resolve(dir, typeof args.license === 'string' ? args.license : 'c2s-license.lic');
  const pubPath = resolve(dir, typeof args.public === 'string' ? args.public : 'license-public.pem');
  if (!existsSync(licensePath)) fail(`não encontrei ${licensePath}.`);
  if (!existsSync(pubPath)) fail(`não encontrei ${pubPath}.`);

  const license = JSON.parse(readFileSync(licensePath, 'utf8'));
  if (typeof license.payload !== 'string' || typeof license.signature !== 'string') {
    fail('arquivo .lic sem payload/signature.');
  }

  const publicKey = createPublicKey(readFileSync(pubPath));
  const ok = verify(
    null,
    Buffer.from(license.payload, 'ascii'),
    publicKey,
    Buffer.from(license.signature, 'base64url'),
  );
  if (!ok) fail('assinatura não confere.');

  const payload = JSON.parse(Buffer.from(license.payload, 'base64url').toString('utf8'));
  console.log('[licenca] assinatura OK');
  console.log('[licenca] cliente:', payload.customer);
  console.log('[licenca] plano:', payload.plan);
  console.log('[licenca] validade:', payload.expiresAt);
  console.log('[licenca] expirada:', new Date(payload.expiresAt).getTime() < Date.now() ? 'sim' : 'não');
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (command === 'keygen') {
  keygen(args);
} else if (command === 'sign') {
  signLicense(args);
} else if (command === 'verify') {
  verifyLicense(args);
} else {
  console.log('Uso:');
  console.log('  node scripts/license.mjs keygen [--dir .] [--force]');
  console.log('  node scripts/license.mjs sign --customer "Nome" [--plan pro] [--days 365]');
  console.log('       [--features bucketCapture,autoStatus] [--dir .] [--out arquivo.lic]');
  console.log('  node scripts/license.mjs verify --license arquivo.lic [--public license-public.pem]');
  process.exit(command ? 1 : 0);
}
