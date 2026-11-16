import { DEFAULT_TEMPLATES } from '../../../shared/constants/defaults';
import type { TemplateRecord, TemplateType } from '../../../shared/types/template';
import { nowIso } from '../../../shared/utils/dateUtils';
import { newId } from '../../../shared/utils/idGenerator';
import { dbDelete, dbGetAll, dbPut } from '../indexedDb';

export interface TemplateInput {
  nome: string;
  tipo: TemplateType;
  conteudo: string;
  variaveis?: string[];
  ativo?: boolean;
}

const KNOWN_VARIABLES = ['nome', 'imovel', 'telefone', 'origem', 'corretor', 'imobiliaria', 'data'];

export function extractVariables(conteudo: string): string[] {
  const found = Array.from(conteudo.matchAll(/\{(\w+)\}/g)).map((match) => match[1] ?? '');
  return Array.from(new Set(found.filter((item) => KNOWN_VARIABLES.includes(item))));
}

export class TemplateRepository {
  async ensureDefaults(): Promise<TemplateRecord[]> {
    const rows = await dbGetAll<TemplateRecord>('templates');
    if (rows.length > 0) return rows;
    const agora = nowIso();
    const seeded = DEFAULT_TEMPLATES.map((template) => ({
      ...template,
      criadoEm: agora,
      atualizadoEm: agora,
    }));
    for (const template of seeded) await dbPut('templates', template);
    return seeded;
  }

  async list(): Promise<TemplateRecord[]> {
    const rows = await this.ensureDefaults();
    return rows.sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async activeByType(tipo: TemplateType): Promise<TemplateRecord | undefined> {
    const rows = await this.list();
    return rows.find((row) => row.tipo === tipo && row.ativo);
  }

  async create(input: TemplateInput): Promise<TemplateRecord> {
    const agora = nowIso();
    const record: TemplateRecord = {
      id: newId('tpl'),
      nome: input.nome.slice(0, 120),
      tipo: input.tipo,
      conteudo: input.conteudo.slice(0, 4_000),
      variaveis: input.variaveis ?? extractVariables(input.conteudo),
      ativo: input.ativo !== false,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    await dbPut('templates', record);
    return record;
  }

  async update(id: string, patch: Partial<TemplateInput>): Promise<TemplateRecord | undefined> {
    const rows = await this.list();
    const existing = rows.find((row) => row.id === id);
    if (!existing) return undefined;
    const conteudo = patch.conteudo?.slice(0, 4_000) ?? existing.conteudo;
    const record: TemplateRecord = {
      ...existing,
      ...patch,
      conteudo,
      variaveis: patch.variaveis ?? extractVariables(conteudo),
      atualizadoEm: nowIso(),
    };
    await dbPut('templates', record);
    return record;
  }

  async remove(id: string): Promise<void> {
    await dbDelete('templates', id);
  }

  /** Substitui variáveis conhecidas e remove as desconhecidas. */
  render(template: TemplateRecord, values: Record<string, string | number | undefined>): string {
    return template.conteudo.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = values[key];
      return value === undefined || value === null || value === '' ? '' : String(value);
    });
  }
}

export const templateRepository = new TemplateRepository();
