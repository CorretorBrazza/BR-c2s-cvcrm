import type { EventLogRecord, EventType } from '../../shared/types/eventLog';
import type { LiveMessage } from '../../shared/types/messages';

type Listener = (event: EventLogRecord) => void;

/**
 * Barramento interno do service worker. Persistência é responsabilidade do
 * eventLogRepository; aqui só distribuímos para listeners e para o painel.
 */
class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(event: EventLogRecord): Promise<void> {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* um listener quebrado não pode derrubar o log */
      }
    }
    await broadcastToPanel({ type: 'event', payload: event });
  }

  isCritical(tipo: EventType): boolean {
    return tipo === 'CAPTURE_SUCCESS' || tipo === 'CAPTURE_LOST_TO_COMPETITOR' || tipo === 'INTERNAL_ERROR';
  }
}

async function broadcastToPanel(message: LiveMessage): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Nenhum painel aberto: normal, não é erro.
  }
}

export const eventBus = new EventBus();
export { broadcastToPanel };
