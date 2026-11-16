import type { InterceptedEvent, InterceptedRequest } from '../../shared/bridge/protocol';
import type { NetworkSample } from '../../shared/types/inspection';
import { detectPageContext } from '../parsers/pageContext';
import { sendToBackground } from '../utils/bridge';

interface PendingRequest extends InterceptedRequest {
  key: string;
}

const MAX_PENDING_PER_KEY = 5;
const MAX_AGE_MS = 120_000;

/**
 * Agrupa request/response do MAIN world em amostras coerentes.
 * O pareamento é por método+URL e janela de 120s.
 */
export class NetworkRecorder {
  private pending = new Map<string, PendingRequest[]>();
  private buffer: NetworkSample[] = [];
  private timer: number | undefined;
  private enabled = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pending.clear();
      this.buffer = [];
      this.stopTimer();
    } else {
      this.startTimer();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  handle(event: InterceptedEvent): void {
    if (!this.enabled) return;
    if (event.kind === 'request') {
      this.onRequest(event.data);
      return;
    }
    this.onResponse(event.data);
  }

  private keyOf(method: string, url: string): string {
    return `${method.toUpperCase()}|${url}`;
  }

  private onRequest(request: InterceptedRequest): void {
    const key = this.keyOf(request.method, request.url);
    const list = this.pending.get(key) ?? [];
    list.push({ ...request, key });
    this.pending.set(key, list.slice(-MAX_PENDING_PER_KEY));
  }

  private onResponse(response: {
    url: string;
    method: string;
    status?: number;
    responseContentType?: string | null;
    responseBody?: string | null;
    truncated?: boolean;
    durationMs?: number;
    erro?: string;
  }): void {
    const key = this.keyOf(response.method, response.url);
    const list = this.pending.get(key) ?? [];
    const agora = Date.now();

    let request: PendingRequest | undefined;
    while (list.length > 0) {
      const candidate = list.shift();
      if (candidate && agora - candidate.startedAt <= MAX_AGE_MS) {
        request = candidate;
        break;
      }
    }
    if (list.length === 0) this.pending.delete(key);

    const page = detectPageContext();
    this.buffer.push({
      id: `net_${agora.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      correlationId: `corr_${agora.toString(36)}`,
      timestamp: new Date().toISOString(),
      url: response.url,
      method: response.method.toUpperCase(),
      status: response.status,
      endpointType: 'DESCONHECIDO',
      durationMs: response.durationMs,
      requestHeaders: request?.requestHeaders,
      requestBody: request?.requestBody ?? null,
      responseBody: response.responseBody ?? null,
      responseContentType: response.responseContentType ?? null,
      responseSize: typeof response.responseBody === 'string' ? response.responseBody.length : undefined,
      truncated: response.truncated === true,
      untrusted: true,
      pageContext: page.context,
      erro: response.erro,
    });

    if (this.buffer.length >= 25) this.flush();
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const samples = this.buffer.splice(0, this.buffer.length);
    sendToBackground({ kind: 'insp:network', id: 'content', payload: samples });
  }

  private startTimer(): void {
    if (this.timer !== undefined) return;
    this.timer = window.setInterval(() => this.flush(), 800);
  }

  private stopTimer(): void {
    if (this.timer === undefined) return;
    window.clearInterval(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.flush();
    this.stopTimer();
    this.pending.clear();
  }
}
