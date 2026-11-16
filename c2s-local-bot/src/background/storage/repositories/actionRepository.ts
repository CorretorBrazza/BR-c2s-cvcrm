import type { ActionStatus, ActionType, LeadActionRecord } from '../../../shared/types/action';
import { nowIso } from '../../../shared/utils/dateUtils';
import { newId } from '../../../shared/utils/idGenerator';
import { dbGet, dbGetAll, dbPut, dbQueryDesc } from '../indexedDb';

export interface NewActionInput {
  tipo: ActionType;
  leadId?: string;
  c2sLeadId?: string;
  payload?: unknown;
  maxTentativas?: number;
  status?: ActionStatus;
}

export class ActionRepository {
  async create(input: NewActionInput): Promise<LeadActionRecord> {
    const agora = nowIso();
    const record: LeadActionRecord = {
      id: newId('act'),
      tipo: input.tipo,
      leadId: input.leadId,
      c2sLeadId: input.c2sLeadId,
      payload: input.payload,
      status: input.status ?? 'PENDENTE',
      tentativa: 0,
      maxTentativas: input.maxTentativas ?? 3,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    await dbPut('lead_actions', record);
    return record;
  }

  async update(id: string, patch: Partial<LeadActionRecord>): Promise<LeadActionRecord | undefined> {
    const existing = await dbGet<LeadActionRecord>('lead_actions', id);
    if (!existing) return undefined;
    const record: LeadActionRecord = { ...existing, ...patch, id, atualizadoEm: nowIso() };
    await dbPut('lead_actions', record);
    return record;
  }

  async list(options: { limit?: number; leadId?: string } = {}): Promise<LeadActionRecord[]> {
    const rows = await dbQueryDesc<LeadActionRecord>('lead_actions', 'iniciadoEm', {
      limit: options.limit ?? 100,
    });
    return options.leadId ? rows.filter((row) => row.leadId === options.leadId) : rows;
  }

  async all(): Promise<LeadActionRecord[]> {
    return dbGetAll<LeadActionRecord>('lead_actions');
  }
}

export const actionRepository = new ActionRepository();
