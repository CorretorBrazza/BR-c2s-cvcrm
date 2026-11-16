import { C2S_PATHS } from '../constants/endpoints';

/**
 * Reconhecimento da ÚNICA prova de interação aceita sem confirmação manual:
 * resposta enviada pelo próprio C2S (`POST /webapp/leads/super_reply`).
 *
 * Clique em WhatsApp não passa por aqui de propósito. O corpo da mensagem
 * nunca é lido nem persistido — só o `id` do lead, e ainda assim apenas em
 * memória, para casar request e response.
 */

const MAX_ID_LENGTH = 20;

function pathOf(url: string): string {
  try {
    return new URL(url, 'https://api.contact2sale.com').pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function isSuperReplyUrl(url: string): boolean {
  return pathOf(url) === C2S_PATHS.leadSuperReply;
}

function validId(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const trimmed = text.trim();
  return /^\d{1,20}$/.test(trimmed) ? trimmed.slice(0, MAX_ID_LENGTH) : null;
}

/**
 * Extrai o id do lead de um corpo de reply. Aceita o FormData serializado
 * (`id=...&body=...`) e JSON (`{"id":...}`). Qualquer outro campo é ignorado.
 */
export function leadIdFromReplyBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return validId(parsed.id ?? parsed.lead_id);
    } catch {
      return null;
    }
  }

  const params = new URLSearchParams(trimmed);
  return validId(params.get('id') ?? params.get('lead_id'));
}

/**
 * `super_reply` responde `{ success: boolean }`. Um 2xx com `success:false`
 * significa que o C2S recusou o envio — não é interação.
 */
export function replyResponseSucceeded(
  status: number | undefined,
  responseBody: string | null | undefined,
): boolean {
  if (status === undefined || status < 200 || status >= 300) return false;
  if (!responseBody) return true;

  try {
    const parsed = JSON.parse(responseBody) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      return parsed.success === true;
    }
  } catch {
    /* corpo não-JSON: o 2xx já é a evidência disponível */
  }
  return true;
}
