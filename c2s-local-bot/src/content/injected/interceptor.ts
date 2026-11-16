/**
 * Interceptor — MAIN world.
 *
 * Roda no contexto da página (api.contact2sale.com) apenas para observar
 * requisições que a própria página faz. Não altera respostas, não bloqueia
 * nada e não executa código remoto.
 *
 * Comunicação: window.postMessage com nonce + validação do lado ISOLATED.
 * Nada aqui é confiável para o service worker — é contrato explícito.
 */
import {
  BRIDGE_CHANNEL,
  BRIDGE_LIMITS,
  isC2sApiUrl,
  sanitizeHeaders,
  truncateBody,
  type BridgeEnvelope,
  type InterceptedEvent,
} from '../../shared/bridge/protocol';

(() => {
  const globalScope = window as unknown as { __C2S_BOT_INTERCEPTOR__?: boolean };
  if (globalScope.__C2S_BOT_INTERCEPTOR__) return;
  globalScope.__C2S_BOT_INTERCEPTOR__ = true;

  const MINTERCEPT_INTERESTING =
    /(\/bucket_leads|\/webapp\/leads|\/leads\/|kanban_funnels|status_update|super_reply|register_whatsapp_click|activity)/i;

  let nonce = '';
  let acked = false;
  let enabled = false;
  let helloTimer: number | undefined;
  let helloAttempts = 0;

  function generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function post(type: string, payload: unknown): void {
    if (!nonce) return;
    const envelope: BridgeEnvelope = {
      channel: BRIDGE_CHANNEL,
      type,
      nonce,
      sentAt: Date.now(),
      payload,
    };
    try {
      window.postMessage(envelope, window.location.origin);
    } catch {
      /* postMessage nunca deve derrubar a página */
    }
  }

  function emit(event: InterceptedEvent): void {
    if (!enabled || !acked) return;
    post('INTERCEPTED', event);
  }

  function isInteresting(url: string): boolean {
    return MINTERCEPT_INTERESTING.test(url);
  }

  function absolute(url: string): string {
    try {
      return new URL(url, window.location.origin).toString();
    } catch {
      return url.slice(0, BRIDGE_LIMITS.maxUrlChars);
    }
  }

  function serializeBody(body: unknown): string | null {
    if (body === null || body === undefined) return null;
    if (typeof body === 'string') return truncateBody(body).body;
    if (body instanceof URLSearchParams) {
      return truncateBody(body.toString()).body;
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const parts: string[] = [];
      let total = 0;
      body.forEach((value, key) => {
        if (total >= 20_000) return;
        const text = typeof value === 'string' ? value : '[arquivo]';
        const line = `${key}=${text}`;
        parts.push(line);
        total += line.length;
      });
      return truncateBody(parts.join('&')).body;
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) return '[blob]';
    if (typeof body === 'object') {
      try {
        return truncateBody(JSON.stringify(body)).body;
      } catch {
        return '[objeto nao serializavel]';
      }
    }
    return null;
  }

  /* ------------------------------ fetch ------------------------------ */

  const originalFetch = window.fetch;

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = absolute(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (
      init?.method ??
      (typeof input === 'object' && 'method' in input ? input.method : 'GET')
    ).toUpperCase();

    const startedAt = Date.now();
    const interesting = enabled && isInteresting(url);

    if (interesting) {
      let requestBody: string | null = null;
      if (init?.body !== undefined) requestBody = serializeBody(init.body);

      emit({
        kind: 'request',
        data: {
          url,
          method,
          requestHeaders: init?.headers ? sanitizeHeaders(init.headers) : undefined,
          requestBody,
          startedAt,
        },
      });
    }

    try {
      const response = await originalFetch.call(window, input, init);
      if (interesting) {
        void captureFetchResponse(url, method, response, startedAt);
      }
      return response;
    } catch (error) {
      if (interesting) {
        emit({
          kind: 'response',
          data: {
            url,
            method,
            durationMs: Date.now() - startedAt,
            erro: error instanceof Error ? error.message.slice(0, 300) : 'falha de rede',
          },
        });
      }
      throw error;
    }
  } as typeof window.fetch;

  async function captureFetchResponse(
    url: string,
    method: string,
    response: Response,
    startedAt: number,
  ): Promise<void> {
    let responseBody: string | null = null;
    let truncated = false;
    try {
      const clone = response.clone();
      const contentType = clone.headers.get('content-type');
      if (contentType && /json|text|html|javascript|xml/i.test(contentType)) {
        const text = await clone.text();
        const result = truncateBody(text);
        responseBody = result.body;
        truncated = result.truncated;
      }
    } catch {
      responseBody = null;
    }

    emit({
      kind: 'response',
      data: {
        url,
        method,
        status: response.status,
        responseContentType: response.headers.get('content-type'),
        responseBody,
        truncated,
        durationMs: Date.now() - startedAt,
      },
    });
  }

  /* -------------------------------- XHR ------------------------------- */

  interface XhrMeta {
    method: string;
    url: string;
    startedAt: number;
    body?: string | null;
  }

  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    const meta: XhrMeta = {
      method: String(method ?? 'GET').toUpperCase(),
      url: absolute(String(url)),
      startedAt: Date.now(),
    };
    xhrMeta.set(this, meta);
    return originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  } as typeof XMLHttpRequest.prototype.open;

  const headerStore = new WeakMap<XMLHttpRequest, Record<string, string>>();

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetHeader(
    this: XMLHttpRequest,
    name: string,
    value: string,
  ): void {
    const store = headerStore.get(this) ?? {};
    if (Object.keys(store).length < BRIDGE_LIMITS.maxHeaderCount) {
      store[String(name).toLowerCase()] = String(value).slice(0, BRIDGE_LIMITS.maxHeaderValueChars);
      headerStore.set(this, store);
    }
    return originalSetRequestHeader.call(this, name, value);
  } as typeof XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.send = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const meta = xhrMeta.get(this);
    const interesting = Boolean(meta && enabled && isInteresting(meta.url));

    if (meta && interesting) {
      meta.body = serializeBody(body);
      emit({
        kind: 'request',
        data: {
          url: meta.url,
          method: meta.method,
          requestHeaders: sanitizeHeaders(headerStore.get(this)),
          requestBody: meta.body ?? null,
          startedAt: meta.startedAt,
        },
      });

      this.addEventListener(
        'loadend',
        () => {
          const responseBody = readXhrBody(this);
          emit({
            kind: 'response',
            data: {
              url: meta.url,
              method: meta.method,
              status: this.status || undefined,
              responseContentType: this.getResponseHeader('content-type'),
              responseBody: responseBody.body,
              truncated: responseBody.truncated,
              durationMs: Date.now() - meta.startedAt,
            },
          });
        },
        { once: true },
      );
    }

    return originalSend.call(this, body ?? null);
  } as typeof XMLHttpRequest.prototype.send;

  function readXhrBody(xhr: XMLHttpRequest): { body: string | null; truncated: boolean } {
    try {
      const type = xhr.responseType;
      if (type === '' || type === 'text') return truncateBody(xhr.responseText);
      if (type === 'json') return truncateBody(JSON.stringify(xhr.response ?? null));
      return { body: null, truncated: false };
    } catch {
      return { body: null, truncated: false };
    }
  }

  /* ----------------------------- handshake ---------------------------- */

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data as unknown;
    if (typeof data !== 'object' || data === null) return;
    const envelope = data as Record<string, unknown>;
    if (envelope.channel !== BRIDGE_CHANNEL) return;
    if (typeof envelope.nonce !== 'string' || envelope.nonce !== nonce) return;

    if (envelope.type === 'ACK' && envelope.payload && typeof envelope.payload === 'object') {
      const accepted = (envelope.payload as Record<string, unknown>).accepted === true;
      if (accepted) {
        acked = true;
        if (helloTimer !== undefined) {
          window.clearInterval(helloTimer);
          helloTimer = undefined;
        }
      }
      return;
    }

    if (envelope.type === 'MODE' && envelope.payload && typeof envelope.payload === 'object') {
      const payload = envelope.payload as Record<string, unknown>;
      enabled = payload.enabled === true;
    }
  });

  nonce = generateNonce();

  function sayHello(): void {
    if (acked) return;
    helloAttempts++;
    post('HELLO', { version: 1, userAgent: navigator.userAgent.slice(0, 200) });
    if (helloAttempts >= 20 && helloTimer !== undefined) {
      window.clearInterval(helloTimer);
      helloTimer = undefined;
    }
  }

  sayHello();
  helloTimer = window.setInterval(sayHello, 250);

  // Sinaliza para depuração local que o interceptor está ativo (sem dados).
  if (isC2sApiUrl(window.location.href, window.location.origin)) {
    document.documentElement.dataset.c2sBotInterceptor = 'on';
  }
})();
