import type { LeadFilters } from '../../../shared/types/messages';
import type { LeadRecord, LeadStatusLocal } from '../../../shared/types/lead';
import { nowIso } from '../../../shared/utils/dateUtils';
import { newId } from '../../../shared/utils/idGenerator';
import { maskPhone } from '../../../shared/utils/phoneUtils';
import { dbCount, dbDelete, dbGetAll, dbGetByIndex, dbPut } from '../indexedDb';

export interface LeadUpsertInput {
  c2sLeadId: string;
  c2sUuid?: string;
  nome?: string;
  telefone?: string;
  email?: string;
  imovel?: string;
  origem?: string;
  origemDetalhe?: string;
  origemTipo?: LeadRecord['origemTipo'];
  statusC2S?: string | null;
  funilId?: string;
  colunaId?: string;
  responsavelId?: string;
  statusLocal?: LeadStatusLocal;
  resultado?: LeadRecord['resultado'];
  bucketAvailableAt?: string;
  raw?: unknown;
}

export class LeadRepository {
  async get(id: string): Promise<LeadRecord | undefined> {
    const rows = await dbGetAll<LeadRecord>('leads');
    return rows.find((row) => row.id === id);
  }

  async findByC2sId(c2sLeadId: string): Promise<LeadRecord | undefined> {
    return dbGetByIndex<LeadRecord>('leads', 'c2sLeadId', c2sLeadId);
  }

  async upsert(input: LeadUpsertInput): Promise<LeadRecord> {
    const existing = await this.findByC2sId(input.c2sLeadId);
    const agora = nowIso();

    const record: LeadRecord = existing
      ? {
          ...existing,
          ...stripUndefined(input),
          c2sLeadId: input.c2sLeadId,
          telefoneMasked: input.telefone ? maskPhone(input.telefone) : existing.telefoneMasked,
          emailMasked: existing.emailMasked,
          statusLocal: input.statusLocal ?? existing.statusLocal,
          resultado: input.resultado ?? existing.resultado,
          atualizadoEm: agora,
        }
      : {
          id: newId('lead'),
          c2sLeadId: input.c2sLeadId,
          c2sUuid: input.c2sUuid,
          nome: input.nome,
          telefone: input.telefone,
          telefoneMasked: input.telefone ? maskPhone(input.telefone) : undefined,
          email: input.email,
          imovel: input.imovel,
          origem: input.origem,
          origemDetalhe: input.origemDetalhe,
          origemTipo: input.origemTipo ?? 'DESCONHECIDA',
          detectadoEm: agora,
          atualizadoEm: agora,
          statusLocal: input.statusLocal ?? 'NOVO',
          statusC2S: input.statusC2S,
          funilId: input.funilId,
          colunaId: input.colunaId,
          responsavelId: input.responsavelId,
          resultado: input.resultado ?? 'PENDENTE',
          tentativas: 0,
          bucketAvailableAt: input.bucketAvailableAt,
          raw: input.raw,
        };

    await dbPut('leads', record);
    return record;
  }

  async update(id: string, patch: Partial<LeadRecord>): Promise<LeadRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    const record: LeadRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      c2sLeadId: existing.c2sLeadId,
      atualizadoEm: nowIso(),
    };
    await dbPut('leads', record);
    return record;
  }

  async list(options: { limit?: number; filters?: LeadFilters } = {}): Promise<LeadRecord[]> {
    const rows = await dbGetAll<LeadRecord>('leads');
    const filters = options.filters ?? {};
    const filtered = rows
      .filter((row) => {
        if (filters.statusLocal && row.statusLocal !== filters.statusLocal) return false;
        if (filters.origemTipo && row.origemTipo !== filters.origemTipo) return false;
        if (filters.resultado && row.resultado !== filters.resultado) return false;
        if (filters.desde && row.detectadoEm < filters.desde) return false;
        if (filters.ate && row.detectadoEm > filters.ate) return false;
        if (filters.busca) {
          const haystack = `${row.nome ?? ''} ${row.telefone ?? ''} ${row.imovel ?? ''} ${row.c2sLeadId}`.toLowerCase();
          if (!haystack.includes(filters.busca.toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => (a.detectadoEm < b.detectadoEm ? 1 : -1));

    return filtered.slice(0, Math.min(options.limit ?? 100, 500));
  }

  async count(): Promise<number> {
    return dbCount('leads');
  }

  async deleteOlderThan(isoCutoff: string): Promise<number> {
    const rows = await dbGetAll<LeadRecord>('leads');
    const antigos = rows.filter((row) => row.detectadoEm < isoCutoff);
    for (const row of antigos) await dbDelete('leads', row.id);
    return antigos.length;
  }
}

function stripUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export const leadRepository = new LeadRepository();
