import { LIMITS } from '../../shared/constants/limits';
import type { PageContext } from '../../shared/types/inspection';
import { nowIso } from '../../shared/utils/dateUtils';
import { broadcastToPanel } from '../events/eventBus';
import { storageGet, storageSet } from '../storage/chromeStorage';

export interface SessionSnapshot {
  conectado: boolean;
  abaC2sAberta: boolean;
  tabId?: number;
  windowId?: number;
  url?: string;
  contexto: PageContext;
  sessaoValida: boolean;
  ultimoPingEm?: string;
  atualizadoEm?: string;
}

const STORAGE_KEY = 'session:snapshot';

/**
 * Sessão = aba do C2S com heartbeat recente + sessão autenticada detectada.
 * Sem "tabs" permission: o tabId vem do sender das mensagens do content script.
 */
class SessionService {
  private state: SessionSnapshot = {
    conectado: false,
    abaC2sAberta: false,
    contexto: 'UNKNOWN',
    sessaoValida: false,
  };

  private listeners = new Set<(snapshot: SessionSnapshot) => void>();

  async hydrate(): Promise<void> {
    const stored = await storageGet<SessionSnapshot>(STORAGE_KEY);
    if (stored) this.state = { ...this.state, ...stored, conectado: false };
  }

  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(): SessionSnapshot {
    return this.evaluate();
  }

  async update(input: {
    tabId?: number;
    windowId?: number;
    url: string;
    context: PageContext;
    sessaoValida: boolean;
  }): Promise<SessionSnapshot> {
    this.state = {
      ...this.state,
      ...(input.tabId !== undefined ? { tabId: input.tabId } : {}),
      ...(input.windowId !== undefined ? { windowId: input.windowId } : {}),
      url: input.url.slice(0, 2_048),
      contexto: input.context,
      sessaoValida: input.sessaoValida,
      abaC2sAberta: true,
      ultimoPingEm: nowIso(),
      atualizadoEm: nowIso(),
    };
    await storageSet(STORAGE_KEY, this.state);
    const snapshot = this.evaluate();
    this.notify(snapshot);
    return snapshot;
  }

  async markDisconnected(): Promise<void> {
    this.state = {
      ...this.state,
      conectado: false,
      abaC2sAberta: false,
      sessaoValida: false,
      atualizadoEm: nowIso(),
    };
    await storageSet(STORAGE_KEY, this.state);
    this.notify(this.evaluate());
  }

  private evaluate(): SessionSnapshot {
    const ultimo = this.state.ultimoPingEm;
    const recente = ultimo ? Date.now() - new Date(ultimo).getTime() <= LIMITS.heartbeatStaleMs : false;
    const conectado = Boolean(this.state.abaC2sAberta && recente);
    return { ...this.state, conectado };
  }

  private notify(snapshot: SessionSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* ignora */
      }
    }
    void broadcastToPanel({
      type: 'status',
      payload: {
        status: snapshot.conectado ? 'MONITORANDO' : 'AGUARDANDO',
        botActive: true,
        inspectMode: false,
        conectado: snapshot.conectado,
        atualizadoEm: nowIso(),
      },
    });
  }
}

export const sessionService = new SessionService();
