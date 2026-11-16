import type { ActionType, QueueEntry } from '../../shared/types/action';
import { LIMITS } from '../../shared/constants/limits';
import { nowIso } from '../../shared/utils/dateUtils';
import { newId } from '../../shared/utils/idGenerator';
import { parseJsonSafe } from '../../shared/utils/validation';
import { storageGet, storageSet } from '../storage/chromeStorage';

const STORAGE_KEY = 'queue:actions';

export interface QueuedAction extends QueueEntry {
  tentativas: number;
  maxTentativas: number;
  proximaTentativaEm?: string;
  ultimoErro?: string;
  atualizadoEm: string;
}

export interface QueueStorage {
  load(): Promise<QueuedAction[]>;
  save(entries: QueuedAction[]): Promise<void>;
}

export const chromeQueueStorage: QueueStorage = {
  async load() {
    const raw = await storageGet<unknown>(STORAGE_KEY);
    if (Array.isArray(raw)) {
      return raw.filter((item): item is QueuedAction => validateQueuedAction(item));
    }
    if (typeof raw === 'string') {
      const parsed = parseJsonSafe<unknown>(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is QueuedAction => validateQueuedAction(item)) : [];
    }
    return [];
  },
  async save(entries) {
    await storageSet(STORAGE_KEY, entries);
  },
};

export function memoryQueueStorage(): QueueStorage {
  let entries: QueuedAction[] = [];
  return {
    async load() {
      return entries.map((entry) => ({ ...entry }));
    },
    async save(next) {
      entries = next.map((entry) => ({ ...entry }));
    },
  };
}

function validateQueuedAction(value: unknown): value is QueuedAction {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.actionId === 'string' &&
    typeof entry.tipo === 'string' &&
    typeof entry.prioridade === 'number' &&
    typeof entry.criadoEm === 'string' &&
    typeof entry.tentativas === 'number' &&
    typeof entry.maxTentativas === 'number'
  );
}

export function backoffMs(attempt: number, base = LIMITS.retryBaseMs, max = LIMITS.retryMaxMs): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 10));
  return Math.min(max, base * 2 ** safeAttempt);
}

export interface EnqueueInput {
  actionId?: string;
  tipo: ActionType;
  c2sLeadId?: string;
  prioridade?: number;
  maxTentativas?: number;
}

export class ActionQueue {
  constructor(private storage: QueueStorage = chromeQueueStorage) {}

  async enqueue(input: EnqueueInput): Promise<QueuedAction> {
    const entries = await this.storage.load();
    const agora = nowIso();
    const entry: QueuedAction = {
      actionId: input.actionId ?? newId('act'),
      tipo: input.tipo,
      ...(input.c2sLeadId ? { c2sLeadId: input.c2sLeadId } : {}),
      prioridade: input.prioridade ?? 5,
      criadoEm: agora,
      atualizadoEm: agora,
      tentativas: 0,
      maxTentativas: input.maxTentativas ?? LIMITS.maxRetries,
    };
    entries.push(entry);
    await this.storage.save(entries);
    return entry;
  }

  async list(): Promise<QueuedAction[]> {
    return this.storage.load();
  }

  async size(): Promise<number> {
    return (await this.storage.load()).length;
  }

  /** Próximo item elegível: maior prioridade, mais antigo e fora do backoff. */
  async peek(now = Date.now()): Promise<QueuedAction | undefined> {
    const entries = await this.storage.load();
    const eligible = entries.filter(
      (entry) => !entry.proximaTentativaEm || new Date(entry.proximaTentativaEm).getTime() <= now,
    );
    return eligible.sort((a, b) => {
      if (b.prioridade !== a.prioridade) return b.prioridade - a.prioridade;
      return a.criadoEm < b.criadoEm ? -1 : 1;
    })[0];
  }

  async remove(actionId: string): Promise<void> {
    const entries = await this.storage.load();
    await this.storage.save(entries.filter((entry) => entry.actionId !== actionId));
  }

  async fail(actionId: string, error: string, retryable = true): Promise<'retry' | 'dead'> {
    const entries = await this.storage.load();
    const index = entries.findIndex((entry) => entry.actionId === actionId);
    if (index < 0) return 'dead';
    const entry = entries[index];
    if (!entry) return 'dead';

    const tentativas = entry.tentativas + 1;
    const dead = !retryable || tentativas >= entry.maxTentativas;

    if (dead) {
      entries.splice(index, 1);
      await this.storage.save(entries);
      return 'dead';
    }

    entries[index] = {
      ...entry,
      tentativas,
      ultimoErro: error.slice(0, 300),
      proximaTentativaEm: new Date(Date.now() + backoffMs(tentativas)).toISOString(),
      atualizadoEm: nowIso(),
    };
    await this.storage.save(entries);
    return 'retry';
  }

  async clear(): Promise<void> {
    await this.storage.save([]);
  }
}

export const actionQueue = new ActionQueue();
