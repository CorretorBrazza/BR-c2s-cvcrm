/**
 * Cliente da ponte no lado ISOLATED.
 *
 * O MAIN world é tratado como hostil: validamos origem, source, forma do
 * envelope, nonce do handshake e o formato do evento antes de repassar
 * qualquer coisa para o restante do content script.
 */
import {
  BRIDGE_CHANNEL,
  isBridgeEnvelope,
  isInterceptedRequest,
  isInterceptedResponse,
  isValidNonce,
  type BridgeEnvelope,
  type InterceptedEvent,
} from '../../shared/bridge/protocol';

export interface BridgeClientOptions {
  onEvent(event: InterceptedEvent): void;
  onHello?(info: { userAgent: string; nonce: string }): void;
  onAckTimeout?(): void;
}

export interface BridgeClient {
  enableCapture(enabled: boolean): void;
  isReady(): boolean;
  nonce(): string;
  dispose(): void;
}

const MAX_EVENTS_PER_SECOND = 120;

export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  let acceptedNonce: string | null = null;
  let ready = false;
  let captureEnabled = false;
  let windowStart = Date.now();
  let windowCount = 0;
  let disposed = false;

  function rateLimited(): boolean {
    const agora = Date.now();
    if (agora - windowStart > 1_000) {
      windowStart = agora;
      windowCount = 0;
    }
    windowCount++;
    return windowCount > MAX_EVENTS_PER_SECOND;
  }

  function send(envelope: Partial<BridgeEnvelope> & { type: string; payload: unknown }): void {
    if (!acceptedNonce) return;
    try {
      window.postMessage(
        {
          channel: BRIDGE_CHANNEL,
          type: envelope.type,
          nonce: acceptedNonce,
          sentAt: Date.now(),
          payload: envelope.payload,
        },
        window.location.origin,
      );
    } catch {
      /* ignora */
    }
  }

  function handleMessage(event: MessageEvent): void {
    if (disposed) return;
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data as unknown;
    if (!isBridgeEnvelope(data)) return;

    if (data.type === 'HELLO') {
      if (event.origin !== window.location.origin) return;
      const payload = data.payload;
      if (typeof payload !== 'object' || payload === null) return;
      const info = payload as Record<string, unknown>;
      if (info.version !== 1) return;

      // Aceita o primeiro handshake válido; reenvios com o mesmo nonce são idempotentes.
      if (acceptedNonce && data.nonce !== acceptedNonce) return;
      if (!isValidNonce(data.nonce)) return;

      acceptedNonce = data.nonce;
      ready = true;
      send({ type: 'ACK', payload: { accepted: true } });
      send({ type: 'MODE', payload: { enabled: captureEnabled } });
      options.onHello?.({
        userAgent: typeof info.userAgent === 'string' ? info.userAgent.slice(0, 200) : '',
        nonce: acceptedNonce,
      });
      return;
    }

    if (!acceptedNonce || data.nonce !== acceptedNonce) return;

    if (data.type === 'INTERCEPTED') {
      if (!captureEnabled) return;
      if (rateLimited()) return;

      const payload = data.payload;
      if (typeof payload !== 'object' || payload === null) return;
      const candidate = payload as Record<string, unknown>;
      if (candidate.kind === 'request' && isInterceptedRequest(candidate.data)) {
        options.onEvent({ kind: 'request', data: candidate.data });
        return;
      }
      if (candidate.kind === 'response' && isInterceptedResponse(candidate.data)) {
        options.onEvent({ kind: 'response', data: candidate.data });
      }
    }
  }

  window.addEventListener('message', handleMessage);

  return {
    enableCapture(enabled: boolean): void {
      captureEnabled = enabled;
      if (ready) send({ type: 'MODE', payload: { enabled } });
    },
    isReady(): boolean {
      return ready;
    },
    nonce(): string {
      return acceptedNonce ?? '';
    },
    dispose(): void {
      disposed = true;
      window.removeEventListener('message', handleMessage);
    },
  };
}
