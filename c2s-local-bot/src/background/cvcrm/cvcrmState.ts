import { CVRM_LIMITS } from '../../shared/constants/cvcrm';
import { emptyCvState } from '../../shared/analysis/cvcrmPolicy';
import type { CvMove, CvMoveState, CvState } from '../../shared/types/cvcrm';

/**
 * Persistência do módulo CV CRM.
 *
 * Fica em `chrome.storage.local` (poucos KB, precisa sobreviver ao service
 * worker) e é sempre sanitizada na leitura: nada de confiar no que está
 * gravado — inclusive depois de uma atualização da extensão.
 */

const KEY = 'cvcrm:state';

const MOVE_STATES: readonly CvMoveState[] = [
  'PENDENTE',
  'ARMADO',
  'CLICADO',
  'CONFIRMADO',
  'FALHA',
  'BLOQUEADO',
];

function texto(value: unknown, max = 40): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function ids(value: unknown, max = 1_000): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && /^\d{1,20}$/.test(item)).slice(0, max);
}

function mapaDeIso(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const saida: Record<string, string> = {};
  for (const [chave, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{1,20}$/.test(chave) || typeof item !== 'string') continue;
    saida[chave] = item.slice(0, 40);
  }
  return saida;
}

function mapaDeNumero(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null) return {};
  const saida: Record<string, number> = {};
  for (const [chave, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{1,20}$/.test(chave) || typeof item !== 'number' || !Number.isFinite(item)) continue;
    saida[chave] = Math.round(item);
  }
  return saida;
}

function mover(raw: unknown): CvMove | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const dado = raw as Record<string, unknown>;
  const leadId = texto(dado.leadId, 20);
  const id = texto(dado.id, 60);
  const estado = dado.estado as CvMoveState;
  if (!id || !/^\d{1,20}$/.test(leadId) || !MOVE_STATES.includes(estado)) return null;

  return {
    id,
    leadId,
    estado,
    criadoEm: texto(dado.criadoEm),
    atualizadoEm: texto(dado.atualizadoEm),
    ...(typeof dado.de === 'number' ? { de: dado.de } : {}),
    ...(typeof dado.para === 'number' ? { para: dado.para } : {}),
    ...(typeof dado.motivo === 'string' ? { motivo: dado.motivo.slice(0, 160) } : {}),
    ...(typeof dado.tabId === 'number' ? { tabId: dado.tabId } : {}),
  };
}

export function sanitizeCvState(raw: unknown): CvState {
  const base = emptyCvState();
  if (typeof raw !== 'object' || raw === null) return base;
  const dado = raw as Record<string, unknown>;

  const movimentos = Array.isArray(dado.movimentos)
    ? dado.movimentos
        .map(mover)
        .filter((item): item is CvMove => item !== null)
        .slice(0, CVRM_LIMITS.maxHistorico)
    : [];

  return {
    baselineEm: texto(dado.baselineEm),
    baselineIds: ids(dado.baselineIds),
    primeiraVez: mapaDeIso(dado.primeiraVez),
    ultimaEtapa: mapaDeNumero(dado.ultimaEtapa),
    movimentos,
    pendente: mover(dado.pendente),
    ultimoTickEm: texto(dado.ultimoTickEm),
    ultimoToastEm: texto(dado.ultimoToastEm),
  };
}

function storageDisponivel(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

class CvcrmStateStore {
  private cache: CvState | null = null;

  async load(): Promise<CvState> {
    if (this.cache) return this.cache;
    if (!storageDisponivel()) {
      this.cache = emptyCvState();
      return this.cache;
    }
    try {
      const guardado = await chrome.storage.local.get(KEY);
      this.cache = sanitizeCvState(guardado[KEY]);
    } catch {
      this.cache = emptyCvState();
    }
    return this.cache;
  }

  async save(state: CvState): Promise<CvState> {
    this.cache = state;
    if (!storageDisponivel()) return state;
    try {
      await chrome.storage.local.set({ [KEY]: state });
    } catch {
      /* estado em memória continua válido; o próximo tick regrava */
    }
    return state;
  }

  async update(alteracao: (atual: CvState) => CvState): Promise<CvState> {
    const atual = await this.load();
    return this.save(alteracao(atual));
  }

  async reset(): Promise<CvState> {
    const vazio = emptyCvState();
    this.cache = vazio;
    if (storageDisponivel()) {
      try {
        await chrome.storage.local.remove(KEY);
      } catch {
        /* ignora */
      }
    }
    return vazio;
  }

  /** Só em testes/desenvolvimento. */
  invalidate(): void {
    this.cache = null;
  }
}

export const cvcrmState = new CvcrmStateStore();
