import { useEffect, useState } from 'react';
import type { EventLogRecord } from '../../shared/types/eventLog';
import type { LiveMessage } from '../../shared/types/messages';

export interface LiveState {
  events: EventLogRecord[];
  status: { status: string; conectado: boolean; inspectMode: boolean } | null;
  inspection: { counts: Record<string, number>; ultimaAmostraEm?: string } | null;
}

/**
 * Assina os broadcasts do service worker. Mensagens do próprio painel são
 * ignoradas (elas não têm o campo `type`).
 */
export function useLiveEvents(limit = 50): LiveState {
  const [events, setEvents] = useState<EventLogRecord[]>([]);
  const [status, setStatus] = useState<LiveState['status']>(null);
  const [inspection, setInspection] = useState<LiveState['inspection']>(null);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

    const listener = (message: unknown): boolean => {
      if (typeof message !== 'object' || message === null) return false;
      const live = message as LiveMessage;
      if (live.type === 'event' && live.payload) {
        setEvents((current) => [live.payload, ...current].slice(0, limit));
      }
      if (live.type === 'status' && live.payload) {
        setStatus({
          status: live.payload.status,
          conectado: live.payload.conectado,
          inspectMode: live.payload.inspectMode,
        });
      }
      if (live.type === 'inspection' && live.payload) {
        setInspection(live.payload);
      }
      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [limit]);

  return { events, status, inspection };
}
