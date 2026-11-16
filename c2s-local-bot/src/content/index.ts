import { LIMITS } from '../shared/constants/limits';
import type { InterceptedEvent } from '../shared/bridge/protocol';
import {
  isSuperReplyUrl,
  leadIdFromReplyBody,
  replyResponseSucceeded,
} from '../shared/analysis/interactionDetector';
import { createBridgeClient, type BridgeClient } from './bridge/bridgeClient';
import { NetworkRecorder } from './inspection/networkRecorder';
import { sendDomSample } from './inspection/domRecorder';
import { buildSelectorProfile } from './inspection/selectorProfiler';
import { detectPageContext, isBucketUrl } from './parsers/pageContext';
import { parseLeadDetail } from './parsers/leadParser';
import { parseBucketDom } from './parsers/bucketParser';
import { executeCapture, setCaptureSuspended } from './actions/captureExecutor';
import { executeActivity } from './actions/activityExecutor';
import { probeWindows } from './actions/windowProbe';
import { buildSelectorAudit } from './actions/selectorAudit';
import { sendToBackground, requestBackground, logPageEvent } from './utils/bridge';

const SIGNAL_MIN_INTERVAL_MS = 2_000;
const REPLY_PENDING_TTL_MS = 60_000;
const REPLY_DEDUPE_MS = 30_000;

(() => {
  const globalScope = window as unknown as { __C2S_BOT_CONTENT__?: boolean };
  if (globalScope.__C2S_BOT_CONTENT__) return;
  globalScope.__C2S_BOT_CONTENT__ = true;

  const recorder = new NetworkRecorder();
  let bridge: BridgeClient | null = null;
  let inspectMode = false;
  let ultimoUrl = '';
  let ultimoContexto = '';
  let ultimoDomEm = 0;
  let ultimoScreenshotEm = 0;
  const leadsBolsaoVistos = new Set<string>();
  let ultimoSessaoAviso = 0;

  // Pareamento request/response de super_reply. Fica só em memória e expira.
  const repliesPendentes = new Map<string, { c2sLeadId: string; em: number }>();
  const repliesConfirmados = new Map<string, number>();

  // Sinal de DOM: no máximo um a cada 2s, e nunca em modo inspeção.
  let sinalTimer = 0;
  let ultimoSinalEm = 0;
  let observer: MutationObserver | null = null;

  function reportPage(): void {
    const page = detectPageContext();
    void requestBackground<{ inspectMode: boolean }>({
      kind: 'page:context',
      id: 'content',
      payload: {
        context: page.context,
        url: page.url,
        title: page.title,
        sessaoValida: page.sessaoValida,
      },
    }).then((response) => {
      if (response?.ok && typeof response.data === 'object' && response.data !== null) {
        applyMode((response.data as { inspectMode?: boolean }).inspectMode === true);
      }
    });

    if (page.context !== ultimoContexto) {
      ultimoContexto = page.context;
      logPageEvent({
        tipoEvento: 'C2S_PAGE_DETECTED',
        resultado: page.context,
        motivo: page.evidencias.join(', ').slice(0, 300),
      });
      if (page.context === 'LEAD_DETAIL') onLeadDetail();
      if (page.context === 'BUCKET') onBucketPage();
    }
  }

  function onLeadDetail(): void {
    const snapshot = parseLeadDetail();
    if (!snapshot) return;
    logPageEvent({
      tipoEvento: 'LEAD_DETAIL_OPENED',
      resultado: snapshot.confianca,
      c2sLeadId: snapshot.c2sLeadId,
      seletorUsado: snapshot.seletorUsado,
      contexto: {
        status: snapshot.statusC2S ?? null,
        confianca: snapshot.confianca,
        temReplyArea: snapshot.temReplyArea,
        temWhatsapp: snapshot.temWhatsapp,
      },
    });
  }

  function onBucketPage(): void {
    const snapshot = parseBucketDom();
    logPageEvent({
      tipoEvento: 'BUCKET_PAGE_DETECTED',
      resultado: `${snapshot.totalDisponivel} card(s) no DOM`,
      contexto: { freeTier: snapshot.freeTierLimitReached },
    });
    for (const item of snapshot.itens) {
      if (leadsBolsaoVistos.has(item.c2sLeadId)) continue;
      leadsBolsaoVistos.add(item.c2sLeadId);
      logPageEvent({
        tipoEvento: 'BUCKET_LEAD_DETECTED',
        resultado: item.confianca,
        c2sLeadId: item.c2sLeadId,
        seletorUsado: item.seletorUsado,
      });
    }
  }

  function maybeAutoCapture(kind: 'dom' | 'screenshot' | 'selectors'): void {
    if (!inspectMode) return;
    const agora = Date.now();

    if (kind === 'dom') {
      if (agora - ultimoDomEm < 5_000) return;
      ultimoDomEm = agora;
      sendDomSample();
      return;
    }

    if (kind === 'selectors') {
      const profile = buildSelectorProfile();
      sendToBackground({ kind: 'insp:selectors', id: 'content', payload: profile });
      return;
    }

    if (agora - ultimoScreenshotEm < 10_000) return;
    ultimoScreenshotEm = agora;
    void requestBackground({ kind: 'inspection:screenshot:request', id: 'content' });
  }

  function onPageChanged(): void {
    if (window.location.href === ultimoUrl) return;
    ultimoUrl = window.location.href;

    if (isBucketUrl()) leadsBolsaoVistos.clear();
    reportPage();
    maybeAutoCapture('dom');
    maybeAutoCapture('selectors');
    maybeAutoCapture('screenshot');
  }

  function applyMode(enabled: boolean): void {
    setCaptureSuspended(enabled);
    if (inspectMode === enabled) return;
    inspectMode = enabled;
    // A persistência de amostras só acontece na inspeção...
    recorder.setEnabled(enabled);
    // ...mas a ponte fica ligada sempre: é ela que prova a interação
    // (`super_reply`) e libera o Bolsão. Nada é gravado fora da inspeção.
    bridge?.enableCapture(true);
    if (enabled) {
      sendDomSample();
      sendToBackground({ kind: 'insp:selectors', id: 'content', payload: buildSelectorProfile() });
    }
  }

  /* ------------------------- interação (super_reply) ------------------- */

  function replyKey(method: string, url: string): string {
    return `${method.toUpperCase()}|${url}`;
  }

  function pruneReplies(agora: number): void {
    for (const [key, pending] of repliesPendentes) {
      if (agora - pending.em > REPLY_PENDING_TTL_MS) repliesPendentes.delete(key);
    }
    for (const [id, em] of repliesConfirmados) {
      if (agora - em > REPLY_DEDUPE_MS * 4) repliesConfirmados.delete(id);
    }
  }

  /**
   * Detecta resposta enviada pelo C2S. Não lê o texto da mensagem: só o id do
   * lead no corpo do request e o status/success da resposta.
   */
  function detectInteraction(event: InterceptedEvent): void {
    const agora = Date.now();
    pruneReplies(agora);

    if (event.data.method.toUpperCase() !== 'POST' || !isSuperReplyUrl(event.data.url)) return;

    if (event.kind === 'request') {
      const c2sLeadId = leadIdFromReplyBody(event.data.requestBody);
      if (!c2sLeadId) return;
      repliesPendentes.set(replyKey(event.data.method, event.data.url), { c2sLeadId, em: agora });
      return;
    }

    if (!replyResponseSucceeded(event.data.status, event.data.responseBody)) return;

    const key = replyKey(event.data.method, event.data.url);
    const pending = repliesPendentes.get(key);
    if (!pending || agora - pending.em > REPLY_PENDING_TTL_MS) return;
    repliesPendentes.delete(key);

    const ultimo = repliesConfirmados.get(pending.c2sLeadId) ?? 0;
    if (agora - ultimo < REPLY_DEDUPE_MS) return;
    repliesConfirmados.set(pending.c2sLeadId, agora);

    void requestBackground({
      kind: 'windows:interaction',
      id: 'content',
      payload: { c2sLeadId: pending.c2sLeadId, evidencia: 'SUPER_REPLY' },
    });
  }

  /* ------------------------ sinal de mudança de DOM -------------------- */

  function scheduleDomSignal(): void {
    if (inspectMode || sinalTimer !== 0) return;
    const espera = Math.max(0, SIGNAL_MIN_INTERVAL_MS - (Date.now() - ultimoSinalEm));
    sinalTimer = window.setTimeout(() => {
      sinalTimer = 0;
      ultimoSinalEm = Date.now();
      const page = detectPageContext();
      if (page.context !== 'BUCKET' && page.context !== 'CONTACTS_LIST') return;
      sendToBackground({ kind: 'windows:signal', id: 'content', payload: { url: page.url } });
    }, espera);
  }

  function startObserver(): void {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(() => scheduleDomSignal());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ------------------------- pedidos do service worker ---------------- */

  function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function handleWindowRequest(
    kind: unknown,
    payload: Record<string, unknown>,
    sendResponse: (response: unknown) => void,
  ): boolean {
    if (kind === 'window:probe') {
      // Síncrono: o engine precisa da leitura atual, sem esperar navegação.
      sendResponse({ ok: true, data: probeWindows() });
      return false;
    }

    if (kind === 'window:audit') {
      // Somente leitura: devolve o que cada seletor encontrou na página atual.
      sendResponse({ ok: true, data: buildSelectorAudit() });
      return false;
    }

    if (kind === 'window:capture') {
      const c2sLeadId = typeof payload.c2sLeadId === 'string' ? payload.c2sLeadId : '';
      if (!/^\d{1,20}$/.test(c2sLeadId)) {
        sendResponse({ ok: false, error: 'ID_DE_LEAD_INVALIDO' });
        return false;
      }
      void executeCapture(
        c2sLeadId,
        numberOr(payload.atrasoMinMs, 0),
        numberOr(payload.atrasoMaxMs, 0),
      ).then((result) => sendResponse({ ok: true, data: result }));
      return true;
    }

    if (kind === 'window:activity') {
      const c2sLeadId = typeof payload.c2sLeadId === 'string' ? payload.c2sLeadId : '';
      if (!/^\d{1,20}$/.test(c2sLeadId)) {
        sendResponse({ ok: false, error: 'ID_DE_LEAD_INVALIDO' });
        return false;
      }
      sendResponse({ ok: true, data: executeActivity(c2sLeadId) });
      return false;
    }

    return false;
  }

  /* ------------------------------ bootstrap ---------------------------- */

  bridge = createBridgeClient({
    onEvent: (event) => {
      recorder.handle(event);
      detectInteraction(event);
    },
    onHello: () => {
      logPageEvent({ tipoEvento: 'C2S_PAGE_DETECTED', resultado: 'ponte MAIN/ISOLATED ativa' });
    },
  });

  // Observação contínua (sem gravar nada) para detectar interação e sinalizar
  // o engine quando o DOM muda. A gravação segue restrita à inspeção.
  bridge.enableCapture(true);

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
      if (typeof message !== 'object' || message === null) return false;
      const envelope = message as Record<string, unknown>;
      const payload = (envelope.payload ?? {}) as Record<string, unknown>;

      if (envelope.kind === 'content:mode') {
        applyMode(payload.inspectMode === true);
        return false;
      }
      if (envelope.kind === 'content:capture-dom') {
        sendDomSample();
        return false;
      }
      if (envelope.kind === 'content:profile-selectors') {
        sendToBackground({ kind: 'insp:selectors', id: 'content', payload: buildSelectorProfile() });
        return false;
      }
      if (
        envelope.kind === 'window:probe' ||
        envelope.kind === 'window:audit' ||
        envelope.kind === 'window:capture' ||
        envelope.kind === 'window:activity'
      ) {
        return handleWindowRequest(envelope.kind, payload, sendResponse);
      }
      return false;
    },
  );

  reportPage();
  ultimoUrl = window.location.href;

  if (document.documentElement) {
    startObserver();
  } else {
    window.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  // Heartbeat: mantém o service worker ciente da aba e da sessão.
  window.setInterval(() => {
    const page = detectPageContext();
    void requestBackground<{ inspectMode: boolean }>({
      kind: 'page:heartbeat',
      id: 'content',
      payload: { context: page.context, url: page.url, sessaoValida: page.sessaoValida },
    }).then((response) => {
      if (response?.ok && typeof response.data === 'object' && response.data !== null) {
        applyMode((response.data as { inspectMode?: boolean }).inspectMode === true);
      }
    });

    if (!page.sessaoValida && page.context === 'LOGIN') {
      const agora = Date.now();
      if (agora - ultimoSessaoAviso > 5 * 60_000) {
        ultimoSessaoAviso = agora;
        logPageEvent({
          tipoEvento: 'C2S_SESSION_EXPIRED',
          resultado: 'login',
          motivo: 'Sessão do C2S não está autenticada.',
        });
      }
    }

    onPageChanged();
  }, LIMITS.heartbeatIntervalMs);

  // Detecta navegação SPA (o C2S troca views sem recarregar).
  window.setInterval(onPageChanged, 1_000);

  window.addEventListener('pagehide', () => {
    if (sinalTimer !== 0) {
      window.clearTimeout(sinalTimer);
      sinalTimer = 0;
    }
    observer?.disconnect();
    observer = null;
    recorder.dispose();
    bridge?.dispose();
  });
})();
