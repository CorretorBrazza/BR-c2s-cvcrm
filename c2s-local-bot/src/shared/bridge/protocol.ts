/**
 * Protocolo de ponte entre o interceptor (MAIN world) e o content script (ISOLATED).
 *
 * Regra de ouro: tudo que vem do MAIN world é entrada NÃO CONFIÁVEL, porque
 * roda no mesmo contexto da página e pode ser forjado por qualquer script dela.
 * Por isso:
 *   - handshake com nonce aleatório gerado no MAIN e confirmado pelo ISOLATED;
 *   - toda mensagem precisa carregar o nonce + origem da janela;
 *   - todo payload passa por validação de forma e tamanho antes de ser usado.
 */

export const BRIDGE_CHANNEL = 'C2S_LOCAL_BOT_BRIDGE_V1';

export const BRIDGE_LIMITS = {
  maxPayloadChars: 600_000,
  maxUrlChars: 4_096,
  maxHeaderCount: 60,
  maxHeaderValueChars: 1_024,
} as const;

export interface BridgeEnvelope<T = unknown> {
  channel: typeof BRIDGE_CHANNEL;
  type: string;
  nonce: string;
  sentAt: number;
  payload: T;
}

export type BridgeHello = BridgeEnvelope<{ version: 1; userAgent: string }>;
export type BridgeAck = BridgeEnvelope<{ accepted: boolean }>;

export interface InterceptedRequest {
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  startedAt: number;
}

export interface InterceptedResponse {
  url: string;
  method: string;
  status?: number;
  responseContentType?: string | null;
  responseBody?: string | null;
  truncated?: boolean;
  durationMs?: number;
  erro?: string;
}

export type InterceptedEvent =
  | { kind: 'request'; data: InterceptedRequest }
  | { kind: 'response'; data: InterceptedResponse };

const NONCE_RE = /^[a-f0-9]{32}$/;

export function isValidNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_RE.test(value);
}

export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.channel === BRIDGE_CHANNEL &&
    typeof candidate.type === 'string' &&
    candidate.type.length > 0 &&
    candidate.type.length <= 64 &&
    isValidNonce(candidate.nonce) &&
    typeof candidate.sentAt === 'number' &&
    Number.isFinite(candidate.sentAt)
  );
}

export function isInterceptedRequest(value: unknown): value is InterceptedRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' &&
    candidate.url.length > 0 &&
    candidate.url.length <= BRIDGE_LIMITS.maxUrlChars &&
    typeof candidate.method === 'string' &&
    candidate.method.length <= 16 &&
    typeof candidate.startedAt === 'number' &&
    Number.isFinite(candidate.startedAt)
  );
}

export function isInterceptedResponse(value: unknown): value is InterceptedResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' &&
    candidate.url.length > 0 &&
    candidate.url.length <= BRIDGE_LIMITS.maxUrlChars &&
    typeof candidate.method === 'string' &&
    candidate.method.length <= 16
  );
}

/** Sanitiza headers: só chaves/valores string, tamanho limitado, sem cookies. */
export function sanitizeHeaders(input: unknown): Record<string, string> | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const output: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= BRIDGE_LIMITS.maxHeaderCount) break;
    if (typeof value !== 'string') continue;
    const normalized = key.toLowerCase().slice(0, 80);
    if (normalized === 'cookie' || normalized === 'authorization' || normalized === 'set-cookie') continue;
    output[normalized] = value.slice(0, BRIDGE_LIMITS.maxHeaderValueChars);
    count++;
  }
  return count > 0 ? output : undefined;
}

export function truncateBody(value: string | null | undefined, max = BRIDGE_LIMITS.maxPayloadChars): {
  body: string | null;
  truncated: boolean;
} {
  if (value === null || value === undefined) return { body: null, truncated: false };
  if (typeof value !== 'string') return { body: null, truncated: false };
  if (value.length <= max) return { body: value, truncated: false };
  return { body: value.slice(0, max), truncated: true };
}

export function isC2sApiUrl(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url, origin);
    return parsed.host === 'api.contact2sale.com' && parsed.origin === origin;
  } catch {
    return false;
  }
}
