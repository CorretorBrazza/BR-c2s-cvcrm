import { webcrypto } from 'node:crypto';
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Garante o contrato entre `scripts/license.mjs` e `licenseService`:
 * a assinatura cobre os bytes ASCII da string `payload` (base64url),
 * e a verificação acontece com WebCrypto (SPKI ou raw 32 bytes).
 */
function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function makeLicense(privateKey: import('node:crypto').KeyObject, payload: unknown) {
  const payloadText = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = sign(null, Buffer.from(payloadText, 'ascii'), privateKey).toString('base64url');
  return { licenseKey: JSON.stringify({ payload: payloadText, signature, alg: 'Ed25519' }), payload };
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const spkiPem = `-----BEGIN PUBLIC KEY-----\n${spkiB64}\n-----END PUBLIC KEY-----`;
const rawB64 = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).toString('base64');

const payload = {
  customer: 'Imobiliaria Teste',
  plan: 'pro',
  issuedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  licenseId: 'lic-teste-1',
  features: { bucketCapture: true, autoStatus: true, autoActivity: false, autoMessage: false, metrics: true },
};

let licenseService: typeof import('@/background/license/licenseService').licenseService;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  ({ licenseService } = await import('@/background/license/licenseService'));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('contrato scripts/license.mjs ↔ licenseService', () => {
  it('valida licença assinada com chave pública SPKI', async () => {
    const { licenseKey } = makeLicense(privateKey, payload);
    const state = await licenseService.validate({
      licenseKey,
      offlineLicenseToleranceHours: 48,
      publicKey: spkiPem,
    });
    expect(state.status).toBe('VALIDA');
    expect(state.payload?.customer).toBe('Imobiliaria Teste');
    expect(state.payload?.features.bucketCapture).toBe(true);
    expect(state.payload?.features.autoMessage).toBe(false);
  });

  it('valida licença assinada com chave pública raw (32 bytes)', async () => {
    const { licenseKey } = makeLicense(privateKey, payload);
    const state = await licenseService.validate({
      licenseKey,
      offlineLicenseToleranceHours: 48,
      publicKey: rawB64,
    });
    expect(state.status).toBe('VALIDA');
  });

  it('sem chave pública no build, nenhuma licença é aceita', async () => {
    // Chave vazia = build sem VITE_LICENSE_PUBLIC_KEY: falhar fechado é o certo.
    const { licenseKey } = makeLicense(privateKey, payload);
    const state = await licenseService.validate({
      licenseKey,
      offlineLicenseToleranceHours: 48,
      publicKey: '',
    });
    expect(state.status).toBe('INVALIDA');
    expect(state.motivo).toMatch(/não configurada/);
  });

  it('rejeita payload adulterado', async () => {
    const { licenseKey } = makeLicense(privateKey, payload);
    const parsed = JSON.parse(licenseKey);
    const decoded = JSON.parse(Buffer.from(parsed.payload, 'base64url').toString('utf8'));
    decoded.customer = 'Outro Cliente';
    parsed.payload = b64url(Buffer.from(JSON.stringify(decoded), 'utf8'));

    const state = await licenseService.validate({
      licenseKey: JSON.stringify(parsed),
      offlineLicenseToleranceHours: 48,
      publicKey: spkiPem,
    });
    expect(state.status).toBe('INVALIDA');
    expect(state.motivo).toMatch(/Assinatura não confere/);
  });

  it('licença vencida dentro da tolerância: TOLERANCIA_OFFLINE', async () => {
    const expirada = {
      ...payload,
      issuedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
    };
    const { licenseKey } = makeLicense(privateKey, expirada);
    const state = await licenseService.validate({
      licenseKey,
      offlineLicenseToleranceHours: 48,
      publicKey: spkiPem,
    });
    expect(state.status).toBe('TOLERANCIA_OFFLINE');
  });

  it('licença vencida fora da tolerância: EXPIRADA', async () => {
    const expirada = {
      ...payload,
      issuedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    };
    const { licenseKey } = makeLicense(privateKey, expirada);
    const state = await licenseService.validate({
      licenseKey,
      offlineLicenseToleranceHours: 48,
      publicKey: spkiPem,
    });
    expect(state.status).toBe('EXPIRADA');
  });
});
