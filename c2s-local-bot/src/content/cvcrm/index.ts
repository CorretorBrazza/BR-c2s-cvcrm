import { CVRM_LIMITS } from '../../shared/constants/cvcrm';
import { cvUrlInfo } from '../../shared/analysis/cvcrmPolicy';
import type { CvKanbanLead } from '../../shared/types/cvcrm';
import { readKanban, readToastLeadIds } from './kanbanReader';
import { readPanel } from './panelReader';
import { executarMovimento } from './executor';
import { sendToBackground } from '../utils/bridge';

/**
 * Content script do CV CRM (ISOLATED, `document_end`).
 *
 * Funções, em ordem de importância:
 *  1. responder ao pedido de execução do service worker (decisão + clique nativo);
 *  2. contar ao service worker em que página esta aba está (oráculo da etapa);
 *  3. no kanban, relatar os leads da coluna de entrada e os toasts do CRM.
 *
 * Nada aqui faz requisição de rede: leitura de DOM e mensagens internas.
 */

const SCAN_DEBOUNCE_MS = 1_000;
const HEARTBEAT_MS = CVRM_LIMITS.pollSeconds.default * 1_000;

(() => {
  const escopo = window as unknown as { __C2S_CV_CONTENT__?: boolean };
  if (escopo.__C2S_CV_CONTENT__) return;
  escopo.__C2S_CV_CONTENT__ = true;

  let inspectMode = false;
  let debounceTimer = 0;
  let observer: MutationObserver | null = null;

  function reportarPagina(): void {
    const info = cvUrlInfo(window.location.href);
    if (info.context === 'OUTRO') return;

    const painel = info.context === 'LEAD_ADMIN' ? readPanel(document, window.location.href) : null;
    sendToBackground({
      kind: 'cvcrm:page',
      id: 'content',
      payload: {
        context: info.context,
        url: window.location.href,
        ...(info.leadId ? { leadId: info.leadId } : {}),
        ...(painel && painel.atual !== null ? { atual: painel.atual } : {}),
      },
    });
  }

  function digitalizarKanban(): void {
    const info = cvUrlInfo(window.location.href);
    if (info.context !== 'KANBAN') return;

    const leads: CvKanbanLead[] = readKanban(document);
    const toasts = readToastLeadIds(document);
    sendToBackground({
      kind: 'cvcrm:kanban',
      id: 'content',
      payload: { host: info.host, url: window.location.href, leads, ...(toasts.length > 0 ? { toasts } : {}) },
    });
  }

  function agendarScan(): void {
    if (debounceTimer !== 0) return;
    debounceTimer = window.setTimeout(() => {
      debounceTimer = 0;
      digitalizarKanban();
    }, SCAN_DEBOUNCE_MS);
  }

  function observarKanban(): void {
    if (observer || cvUrlInfo(window.location.href).context !== 'KANBAN') return;
    const alvo = document.body ?? document.documentElement;
    if (!alvo) return;
    observer = new MutationObserver(() => agendarScan());
    observer.observe(alvo, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
      if (typeof message !== 'object' || message === null) return false;
      const envelope = message as Record<string, unknown>;
      const payload = (envelope.payload ?? {}) as Record<string, unknown>;

      if (envelope.kind === 'content:mode') {
        inspectMode = payload.inspectMode === true;
        return false;
      }

      if (envelope.kind === 'cvcrm:scan') {
        sendResponse({ ok: true, data: readKanban(document) });
        return false;
      }

      if (envelope.kind === 'cvcrm:executar') {
        const leadId = typeof payload.leadId === 'string' ? payload.leadId : '';

        // Dupla camada: o gate do service worker já barra a inspeção, mas o
        // content script nunca clica se a mensagem disser que ela está ligada.
        if (inspectMode || payload.inspectMode === true) {
          sendResponse({ ok: false, error: 'MODO_INSPECAO' });
          return false;
        }

        const info = cvUrlInfo(window.location.href);
        if (info.context !== 'LEAD_ADMIN' || !info.leadId) {
          sendResponse({ ok: false, error: 'PAGINA_INCORRETA' });
          return false;
        }
        if (leadId !== info.leadId) {
          sendResponse({ ok: true, data: { ok: false, motivo: 'LEAD_DIVERGENTE', acao: 'NENHUMA' } });
          return false;
        }

        // Responde antes de clicar: o clique dispara navegação de documento.
        const resultado = executarMovimento(document, window, leadId, {
          agendar: (acao) => window.setTimeout(acao, 0),
        });
        sendResponse({ ok: true, data: resultado });
        return false;
      }

      return false;
    },
  );

  const contexto = cvUrlInfo(window.location.href);
  reportarPagina();
  if (contexto.context === 'KANBAN') {
    digitalizarKanban();
    observarKanban();
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', observarKanban, { once: true });
    }
  }

  window.setInterval(() => {
    reportarPagina();
    if (cvUrlInfo(window.location.href).context === 'KANBAN') digitalizarKanban();
  }, HEARTBEAT_MS);

  window.addEventListener('pagehide', () => {
    if (debounceTimer !== 0) {
      window.clearTimeout(debounceTimer);
      debounceTimer = 0;
    }
    observer?.disconnect();
    observer = null;
  });
})();
