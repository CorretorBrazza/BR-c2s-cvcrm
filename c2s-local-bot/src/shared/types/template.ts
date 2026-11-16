export type TemplateType = 'DIRETO' | 'BOLSAO' | 'FOLLOWUP';

export interface TemplateRecord {
  id: string;
  nome: string;
  tipo: TemplateType;
  conteudo: string;
  variaveis: string[];
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}
