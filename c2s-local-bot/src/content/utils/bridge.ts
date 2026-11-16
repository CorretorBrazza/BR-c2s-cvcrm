import type { RuntimeResponse } from '../../shared/types/messages';

/** Mensagem fire-and-forget para o service worker. */
export function sendToBackground(message: unknown): void {
  try {
    chrome.runtime.sendMessage(message, () => {
      // Lê lastError para evitar "Unchecked runtime.lastError" no console.
      void chrome.runtime.lastError;
    });
  } catch {
    /* extensão recarregada: ignora */
  }
}

/** Requisição com resposta; nunca rejeita. */
export async function requestBackground<T = unknown>(
  message: unknown,
): Promise<RuntimeResponse<T> | null> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T> | undefined;
    return response ?? null;
  } catch {
    return null;
  }
}

export function logPageEvent(input: {
  tipoEvento: string;
  resultado?: string;
  motivo?: string;
  seletorUsado?: string;
  endpoint?: string;
  metodoHttp?: string;
  statusHttp?: number;
  duracaoMs?: number;
  c2sLeadId?: string;
  contexto?: Record<string, unknown>;
}): void {
  sendToBackground({ kind: 'log:event', id: 'content', payload: { ...input, origem: 'PAGINA' } });
}
