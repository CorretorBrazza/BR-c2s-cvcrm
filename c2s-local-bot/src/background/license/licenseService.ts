import type {
  LicenseFeatures,
  LicensePayload,
  LicenseState,
  SignedLicense,
} from '../../shared/types/license';
import { nowIso } from '../../shared/utils/dateUtils';
import { parseJsonSafe } from '../../shared/utils/validation';
import { LICENSE_PUBLIC_KEY } from '../../shared/constants/buildInfo';
import { logEvent } from '../events/logEvent';
import { storageGet, storageSet } from '../storage/chromeStorage';
import type { Settings } from '../../shared/types/settings';

const STORAGE_KEY = 'license:state';

const ALL_FEATURES_OFF: LicenseFeatures = {
  bucketCapture: false,
  autoStatus: false,
  autoActivity: false,
  autoMessage: false,
  metrics: false,
};

const NO_LICENSE: LicenseState = {
  status: 'NAO_CONFIGURADA',
  origem: 'NENHUMA',
};

function decodeBase64(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function publicKeyBytes(raw: string): { bytes: Uint8Array; format: 'raw' | 'spki' } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    const body = trimmed
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, '');
    const bytes = decodeBase64(body);
    return bytes ? { bytes, format: 'spki' } : null;
  }
  const bytes = decodeBase64(trimmed);
  if (!bytes || bytes.length !== 32) return null;
  return { bytes, format: 'raw' };
}

function isLicensePayload(value: unknown): value is LicensePayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  const features = payload.features as Record<string, unknown> | undefined;
  return (
    typeof payload.customer === 'string' &&
    payload.customer.length <= 200 &&
    typeof payload.plan === 'string' &&
    ['trial', 'pro', 'enterprise'].includes(payload.plan) &&
    typeof payload.issuedAt === 'string' &&
    typeof payload.expiresAt === 'string' &&
    typeof payload.licenseId === 'string' &&
    Boolean(features) &&
    typeof features === 'object'
  );
}

function parseFeatures(value: unknown): LicenseFeatures {
  if (typeof value !== 'object' || value === null) return ALL_FEATURES_OFF;
  const source = value as Record<string, unknown>;
  return {
    bucketCapture: source.bucketCapture === true,
    autoStatus: source.autoStatus === true,
    autoActivity: source.autoActivity === true,
    autoMessage: source.autoMessage === true,
    metrics: source.metrics === true,
  };
}

function parseSignedLicense(input: string): SignedLicense | null {
  const json = parseJsonSafe<Record<string, unknown>>(input.trim());
  if (!json) return null;
  if (typeof json.payload !== 'string' || typeof json.signature !== 'string') return null;
  if (json.payload.length > 8_000 || json.signature.length > 512) return null;
  return {
    payload: json.payload,
    signature: json.signature,
    alg: 'Ed25519',
    ...(typeof json.keyId === 'string' ? { keyId: json.keyId.slice(0, 64) } : {}),
  };
}

class LicenseService {
  private state: LicenseState = NO_LICENSE;
  private verifyAvailable: boolean | null = null;

  async hydrate(): Promise<LicenseState> {
    const stored = await storageGet<LicenseState>(STORAGE_KEY);
    if (stored) this.state = stored;
    return this.state;
  }

  getState(): LicenseState {
    return this.state;
  }

  /**
   * Valida uma licença offline.
   *
   * `publicKey` existe para testes e para um eventual `keyId` futuro; em
   * produção quem manda é a chave embutida no build (`LICENSE_PUBLIC_KEY`).
   */
  async validate(input: {
    licenseKey: string;
    offlineLicenseToleranceHours: number;
    publicKey?: string;
  }): Promise<LicenseState> {
    const key = input.licenseKey.trim();
    if (!key) return this.persist(NO_LICENSE);

    const signed = parseSignedLicense(key);
    if (!signed) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Formato inválido: cole o conteúdo do arquivo .lic.',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
      });
    }

    const payloadText = signed.payload.trim();
    const payloadBytes = new TextEncoder().encode(payloadText);
    const payloadJson = decodeBase64(payloadText);
    if (!payloadJson) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Payload da licença não é base64 válido.',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
      });
    }

    const payload = parseJsonSafe<unknown>(new TextDecoder().decode(payloadJson));
    if (!isLicensePayload(payload)) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Payload da licença não tem os campos obrigatórios.',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
      });
    }

    const publicKeyRaw = (input.publicKey ?? LICENSE_PUBLIC_KEY).trim();
    if (!publicKeyRaw) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Chave pública de licença não configurada neste build. É preciso gerar um novo build com VITE_LICENSE_PUBLIC_KEY.',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
        payload: { ...payload, features: parseFeatures(payload.features) },
      });
    }

    const keyBytes = publicKeyBytes(publicKeyRaw);
    if (!keyBytes) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Chave pública de licença inválida.',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
      });
    }

    const signatureBytes = decodeBase64(signed.signature);
    if (!signatureBytes || signatureBytes.length !== 64) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Assinatura Ed25519 inválida.',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
      });
    }

    const signatureOk = await this.verify(keyBytes, signatureBytes, payloadBytes);
    if (signatureOk === null) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Este navegador não suporta verificação Ed25519 (requer Chrome 137+).',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
      });
    }
    if (!signatureOk) {
      return this.persist({
        status: 'INVALIDA',
        motivo: 'Assinatura não confere com a chave pública.',
        origem: 'OFFLINE',
        verificadoEm: nowIso(),
      });
    }

    const expiresAt = new Date(payload.expiresAt);
    const agora = new Date();
    const toleranciaMs = Math.max(0, input.offlineLicenseToleranceHours) * 3_600_000;
    const toleranciaAte = Number.isNaN(expiresAt.getTime())
      ? undefined
      : new Date(expiresAt.getTime() + toleranciaMs).toISOString();

    const baseState: LicenseState = {
      status: 'VALIDA',
      payload: { ...payload, features: parseFeatures(payload.features) },
      origem: 'OFFLINE',
      verificadoEm: nowIso(),
      validoAte: payload.expiresAt,
      toleranciaAte,
    };

    if (Number.isNaN(expiresAt.getTime())) {
      return this.persist({
        ...baseState,
        status: 'INVALIDA',
        motivo: 'Data de expiração inválida.',
      });
    }

    if (agora.getTime() > expiresAt.getTime()) {
      if (toleranciaAte && agora.getTime() <= new Date(toleranciaAte).getTime()) {
        return this.persist({
          ...baseState,
          status: 'TOLERANCIA_OFFLINE',
          motivo: 'Licença expirada, dentro da tolerância offline.',
        });
      }
      return this.persist({
        ...baseState,
        status: 'EXPIRADA',
        motivo: 'Licença expirada.',
      });
    }

    return this.persist(baseState);
  }

  private async verify(
    key: { bytes: Uint8Array; format: 'raw' | 'spki' },
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean | null> {
    if (this.verifyAvailable === false) return null;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      this.verifyAvailable = false;
      return null;
    }

    try {
      const algorithm = { name: 'Ed25519' } as unknown as AlgorithmIdentifier;
      const keyBuffer = key.bytes.buffer.slice(
        key.bytes.byteOffset,
        key.bytes.byteOffset + key.bytes.byteLength,
      ) as ArrayBuffer;
      const imported = await subtle.importKey(key.format, keyBuffer, algorithm, false, ['verify']);
      const signatureBuffer = signature.buffer.slice(
        signature.byteOffset,
        signature.byteOffset + signature.byteLength,
      ) as ArrayBuffer;
      const dataBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const ok = await subtle.verify(algorithm, imported, signatureBuffer, dataBuffer);
      this.verifyAvailable = true;
      return ok;
    } catch {
      this.verifyAvailable = false;
      return null;
    }
  }

  private async persist(state: LicenseState): Promise<LicenseState> {
    this.state = state;
    await storageSet(STORAGE_KEY, state);
    const tipo =
      state.status === 'VALIDA'
        ? 'LICENSE_VALIDATED'
        : state.status === 'EXPIRADA' || state.status === 'TOLERANCIA_OFFLINE'
          ? 'LICENSE_EXPIRED'
          : 'LICENSE_INVALID';
    await logEvent({
      tipoEvento: tipo,
      nivel: state.status === 'VALIDA' ? 'INFO' : 'AVISO',
      origem: 'SISTEMA',
      resultado: state.status,
      motivo: state.motivo,
    });
    return state;
  }

  /** Recarrega do storage e revalida (usado por alarme periódico). */
  async refresh(settings: Settings): Promise<LicenseState> {
    return this.validate({
      licenseKey: settings.licenseKey,
      offlineLicenseToleranceHours: settings.offlineLicenseToleranceHours,
    });
  }
}

export const licenseService = new LicenseService();
