import { APP_VERSION } from '../../../shared/constants/defaults';
import type { EventLevel, EventLogRecord, EventType, NewEventLog } from '../../../shared/types/eventLog';
import type { LogFilters } from '../../../shared/types/messages';
import { nowIso } from '../../../shared/utils/dateUtils';
import { newCorrelationId, newId } from '../../../shared/utils/idGenerator';
import { safeJsonStringify, truncate } from '../../../shared/utils/validation';
import { maskDeep, maskText, maskUrl } from '../../security/dataMasking';
import { dbClear, dbDeleteByIndexBefore, dbGetAll, dbPut, dbQueryDesc } from '../indexedDb';

const SUMMARY_MAX = 2_000;

function summarize(value: unknown): string {
  if (value === undefined || value === null) return '';
  const json = typeof value === 'string' ? value : safeJsonStringify(value, SUMMARY_MAX * 2);
  return truncate(maskText(json), SUMMARY_MAX).value;
}

export class EventLogRepository {
  async add(event: NewEventLog): Promise<EventLogRecord> {
    const record: EventLogRecord = {
      ...event,
      id: event.id ?? newId('evt'),
      correlationId: event.correlationId ?? newCorrelationId(),
      tipoEvento: event.tipoEvento,
      nivel: event.nivel ?? 'INFO',
      origem: event.origem ?? 'EXTENSION',
      criadoEm: event.criadoEm ?? nowIso(),
      extensaoVersao: event.extensaoVersao ?? APP_VERSION,
    } as EventLogRecord;

    if (record.endpoint) record.endpoint = maskUrl(record.endpoint);
    if (record.payloadEnviado !== undefined) {
      record.payloadResumido = record.payloadResumido || summarize(record.payloadEnviado);
    }
    if (record.respostaRecebida !== undefined) {
      record.respostaResumida = record.respostaResumida || summarize(record.respostaRecebida);
    }
    if (record.motivo) record.motivo = maskText(record.motivo).slice(0, 500);
    if (record.contexto) record.contexto = maskDeep(record.contexto);

    await dbPut('event_logs', record);
    return record;
  }

  async list(options: { limit?: number; filters?: LogFilters } = {}): Promise<EventLogRecord[]> {
    const limit = Math.min(options.limit ?? 200, 2_000);
    const filters = options.filters ?? {};
    const rows = await dbQueryDesc<EventLogRecord>('event_logs', 'criadoEm', {
      limit: limit * 3,
    });

    return rows
      .filter((row) => {
        if (filters.tipoEvento && row.tipoEvento !== filters.tipoEvento) return false;
        if (filters.nivel && row.nivel !== filters.nivel) return false;
        if (filters.origem && row.origem !== filters.origem) return false;
        if (filters.resultado && row.resultado !== filters.resultado) return false;
        if (filters.leadId && row.leadId !== filters.leadId) return false;
        if (filters.desde && row.criadoEm < filters.desde) return false;
        if (filters.ate && row.criadoEm > filters.ate) return false;
        if (filters.busca) {
          const haystack = `${row.tipoEvento} ${row.motivo ?? ''} ${row.endpoint ?? ''} ${row.resultado ?? ''} ${row.respostaResumida ?? ''}`.toLowerCase();
          if (!haystack.includes(filters.busca.toLowerCase())) return false;
        }
        return true;
      })
      .slice(0, limit);
  }

  async countByLevel(level: EventLevel, sinceIso: string): Promise<number> {
    const rows = await dbGetAll<EventLogRecord>('event_logs');
    return rows.filter((row) => row.nivel === level && row.criadoEm >= sinceIso).length;
  }

  async countByType(tipo: EventType, sinceIso: string): Promise<number> {
    const rows = await dbGetAll<EventLogRecord>('event_logs');
    return rows.filter((row) => row.tipoEvento === tipo && row.criadoEm >= sinceIso).length;
  }

  async deleteOlderThan(isoCutoff: string): Promise<number> {
    return dbDeleteByIndexBefore('event_logs', 'criadoEm', isoCutoff);
  }

  async clear(): Promise<void> {
    await dbClear('event_logs');
  }
}

export const eventLogRepository = new EventLogRepository();
