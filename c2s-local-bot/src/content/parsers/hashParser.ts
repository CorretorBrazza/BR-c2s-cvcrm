import type { LeadHashPayload } from '../../shared/types/lead';
import { parseJsonSafe } from '../../shared/utils/validation';

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = decodeURIComponent(value).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function extractHashFromUrl(url = window.location.href): string | undefined {
  try {
    const match = new URL(url).pathname.match(/\/hash\/([^/?#]+)/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * O hash da URL do lead é base64 de um JSON de contexto:
 * { status, company_id, seller_id, updated_at }.
 * Usado para deduplicar eventos e detectar atualização do lead.
 */
export function parseLeadHash(hash: string | undefined): LeadHashPayload | null {
  if (!hash) return null;
  const decoded = decodeBase64Url(hash);
  if (!decoded) return null;
  const parsed = parseJsonSafe<unknown>(decoded);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const raw = parsed as Record<string, unknown>;
  const payload: LeadHashPayload = {
    ...(typeof raw.status === 'string' || raw.status === null ? { status: raw.status as string | null } : {}),
    ...(typeof raw.company_id === 'number' ? { company_id: raw.company_id } : {}),
    ...(typeof raw.seller_id === 'number' ? { seller_id: raw.seller_id } : {}),
    ...(typeof raw.updated_at === 'string' ? { updated_at: raw.updated_at } : {}),
  };

  const hasSignal =
    payload.status !== undefined ||
    payload.company_id !== undefined ||
    payload.seller_id !== undefined ||
    payload.updated_at !== undefined;
  if (!hasSignal) return null;
  return payload;
}

export function parseLeadHashFromUrl(url = window.location.href): LeadHashPayload | null {
  return parseLeadHash(extractHashFromUrl(url));
}

/** Chave estável para deduplicar "mesmo lead no mesmo estado". */
export function leadStateKey(leadId: string, payload: LeadHashPayload | null): string {
  const status = payload?.status ?? 'desconhecido';
  const updated = payload?.updated_at ?? '';
  return `${leadId}:${status}:${updated}`;
}
