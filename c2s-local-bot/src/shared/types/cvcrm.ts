/**
 * Tipos do módulo CV CRM.
 *
 * O módulo é paralelo ao C2S: mesmo service worker, mesmas notificações, mesma
 * licença — motor próprio. Nada daqui é importado pelo caminho do C2S.
 */

export type CvContext = 'LEAD_ADMIN' | 'KANBAN' | 'LOGIN' | 'OUTRO';

/** Leitura crua do painel `.situacoes-workflow` (o que o DOM prova). */
export interface CvPanelReading {
  leadId: string;
  /** `null` = nenhum `.status.ativo` encontrado (página em transição). */
  atual: number | null;
  etapas: CvPanelItem[];
  /** Quantos `.situacoes-workflow` existem na página. != 1 => não agir. */
  workflows: number;
  temForm: boolean;
}

export interface CvPanelItem {
  id: number;
  label: string;
  ativo: boolean;
  /** Só `true` quando o `<a>` pai executa `modificarSituacao('<id>', ...)`. */
  acionavel: boolean;
}

/** Lead lido do kanban (somente o necessário para decidir). */
export interface CvKanbanLead {
  leadId: string;
  etapa: number;
  /** "Na situação N dia(s)" — granularidade de dias, vem do CRM. */
  diasNaSituacao: number | null;
  criadoDias: number | null;
}

export type CvMoveState =
  | 'PENDENTE'
  | 'ARMADO'
  | 'CLICADO'
  | 'CONFIRMADO'
  | 'FALHA'
  | 'BLOQUEADO';

export interface CvMove {
  id: string;
  leadId: string;
  estado: CvMoveState;
  criadoEm: string;
  atualizadoEm: string;
  de?: number;
  para?: number;
  motivo?: string;
  tabId?: number;
}

/** Estado persistido do módulo (chrome.storage.local). */
export interface CvState {
  /** ISO em que a linha de base foi tirada. Vazio = módulo nunca ativado. */
  baselineEm: string;
  /** Ids que já existiam na coluna de entrada quando ativamos. Nunca mover. */
  baselineIds: string[];
  /** Primeira vez que vimos cada lead (ISO). */
  primeiraVez: Record<string, string>;
  /** Última etapa observada por lead. */
  ultimaEtapa: Record<string, number>;
  movimentos: CvMove[];
  pendente: CvMove | null;
  ultimoTickEm: string;
  /** Relatos de toast (`#toast-container`) ainda não processados. */
  ultimoToastEm: string;
}

export type CvBlockReason =
  | 'SEM_FORM'
  | 'WORKFLOW_AMBIGUO'
  | 'ETAPA_ATUAL_DESCONHECIDA'
  | 'NAO_E_DA_COLUNA_DE_ENTRADA'
  | 'ALVO_INDISPONIVEL'
  | 'LEAD_ID_INVALIDO'
  | 'LEAD_DIVERGENTE';

export type CvDecision =
  | { kind: 'MOVER'; leadId: string; de: number; para: number; labelAlvo: string }
  | { kind: 'NOOP'; motivo: 'JA_ESTA_NO_ALVO' }
  | { kind: 'BLOQUEADO'; motivo: CvBlockReason };

/** Resultado de uma tentativa de execução na página do lead. */
export interface CvExecResult {
  ok: boolean;
  motivo: string;
  acao: 'CLIQUE' | 'NENHUMA';
  etapaAntes?: number;
}

/** Por que a automação do CV CRM está (ou não) liberada. */
export type CvRequirementKey =
  | 'BUILD'
  | 'OPT_IN'
  | 'ROBO'
  | 'INSPECAO'
  | 'LICENCA'
  | 'MODULO'
  | 'MOVER'
  | 'BASELINE';

export interface CvRequirement {
  chave: CvRequirementKey;
  /** Nome curto do requisito, para a lista de conferência. */
  label: string;
  ok: boolean;
  /** Só quando `ok === false`: a frase pronta que o corretor lê. */
  motivo?: string;
}

/** O que o painel mostra sobre o CV CRM. */
export interface CvOverview {
  ativo: boolean;
  /** Módulo ligado no painel (`cvcrmEnabled`). */
  modulo: boolean;
  /** Mover etapa ligado no painel (`cvcrmAutoMove`). */
  mover: boolean;
  automacao: boolean;
  motivos: string[];
  /** O gate item a item — mesma fonte de `motivos`, mas com ✓/✗. */
  requisitos: CvRequirement[];
  baselineEm: string;
  pendente: CvMove | null;
  movimentos: CvMove[];
  elegiveis: CvKanbanLead[];
  conhecidos: number;
  ignorados: number;
  ultimoTickEm?: string;
  kanbanAberto: boolean;
  deteccao: 'TOAST' | 'KANBAN';
  host: string;
  atrasoSeconds: number;
  idadeMaxHoras: number;
  pollSeconds: number;
}
