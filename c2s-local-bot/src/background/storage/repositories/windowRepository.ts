import type { LeadWindow } from '../../../shared/types/window';
import { nowIso } from '../../../shared/utils/dateUtils';
import { newId } from '../../../shared/utils/idGenerator';
import { dbDelete, dbGetAll, dbPut } from '../indexedDb';

export interface WindowSeed {
  c2sLeadId: string;
  origem: LeadWindow['origem'];
  acao: LeadWindow['acao'];
  detectadoEm: string;
  prazoEm: string;
  confianca: LeadWindow['confianca'];
  nome?: string;
}

export class WindowRepository {
  async all(): Promise<LeadWindow[]> {
    const rows = await dbGetAll<LeadWindow>('lead_windows');
    return rows.sort((a, b) => (a.prazoEm < b.prazoEm ? -1 : 1));
  }

  async byId(id: string): Promise<LeadWindow | undefined> {
    return (await this.all()).find((window) => window.id === id);
  }

  async byLead(c2sLeadId: string): Promise<LeadWindow | undefined> {
    return (await this.all()).find((window) => window.c2sLeadId === c2sLeadId);
  }

  async create(seed: WindowSeed): Promise<LeadWindow> {
    const agora = nowIso();
    const window: LeadWindow = {
      id: newId('win'),
      c2sLeadId: seed.c2sLeadId,
      origem: seed.origem,
      acao: seed.acao,
      estado: 'DETECTADO',
      detectadoEm: seed.detectadoEm,
      prazoEm: seed.prazoEm,
      tentativas: 0,
      confianca: seed.confianca,
      ...(seed.nome ? { nome: seed.nome } : {}),
      atualizadoEm: agora,
    };
    await dbPut('lead_windows', window);
    return window;
  }

  async patch(id: string, patch: Partial<LeadWindow>): Promise<LeadWindow | undefined> {
    const existing = await this.byId(id);
    if (!existing) return undefined;
    const next: LeadWindow = {
      ...existing,
      ...patch,
      id: existing.id,
      c2sLeadId: existing.c2sLeadId,
      atualizadoEm: nowIso(),
    };
    await dbPut('lead_windows', next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await dbDelete('lead_windows', id);
  }

  async clearAll(): Promise<number> {
    const rows = await this.all();
    for (const window of rows) await dbDelete('lead_windows', window.id);
    return rows.length;
  }

  async clearTerminal(keepDays = 7): Promise<number> {
    const cutoff = Date.now() - Math.max(1, keepDays) * 86_400_000;
    const rows = await this.all();
    const terminadas = rows.filter(
      (window) =>
        ['INTERACAO_CONFIRMADA', 'EXPIRADO', 'FALHA'].includes(window.estado) &&
        new Date(window.atualizadoEm).getTime() < cutoff,
    );
    for (const window of terminadas) await dbDelete('lead_windows', window.id);
    return terminadas.length;
  }
}

export const windowRepository = new WindowRepository();
