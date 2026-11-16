/**
 * Contrato do CV CRM (white-label, server-rendered).
 *
 * Tudo aqui foi lido de páginas reais do corretor:
 *  - `.situacoes-workflow`: painel de etapas da página `/leads/{id}/administrar`;
 *  - `#form_situacao`: formulário que o próprio CRM submete (navegação de documento);
 *  - `.aw-flow-col`: colunas do kanban `/corretor/comercial/andamentoleads`.
 *
 * Regras que este arquivo NÃO pode perder:
 *  1. Etapa é identificada por **id numérico**, nunca por rótulo. O kanban trunca
 *     o título em ~24 caracteres e um rótulo tem espaço à direita.
 *  2. Só existe um caminho válido para mudar etapa: clicar o `<a>` que executa
 *     `modificarSituacao('<id>', '<label>')`. O POST real carrega `post[...]` e um
 *     `tk` de 128 hex gerado em tempo de submit, que não existe no DOM e não é
 *     reproduzível — por isso o executor jamais forja a requisição.
 *  3. `Descartado` usa `chamaFacebox(...)`: handler diferente, alvo proibido.
 */

export type CvStageRole = 'ENTRADA' | 'ALVO' | 'PROIBIDA' | 'OUTRA';

export interface CvStageDef {
  id: number;
  label: string;
  papel: CvStageRole;
  /** Cor publicada pelo CRM no `<span class="status">`. Só para a UI. */
  cor?: string;
}

/**
 * Tabela confirmada no dump do lead 91293 e no kanban.
 * `11` tem espaço à direita no rótulo original — de propósito.
 */
export const CVRM_STAGES: readonly CvStageDef[] = [
  { id: 1, label: 'Aguardando Atendimento', papel: 'OUTRA', cor: '#0030ff' },
  { id: 2, label: 'Aguardando Atendimento Corretor', papel: 'ENTRADA', cor: '#ffcf01' },
  { id: 3, label: 'Descartado', papel: 'PROIBIDA' },
  { id: 4, label: 'Em Atendimento', papel: 'ALVO', cor: '#f97000' },
  { id: 5, label: 'Com Reserva', papel: 'OUTRA', cor: '#ffd600' },
  { id: 6, label: 'Venda Realizada', papel: 'OUTRA', cor: '#006600' },
  { id: 7, label: 'Em Análise de Crédito', papel: 'OUTRA', cor: '#ec6dfb' },
  { id: 9, label: 'Visita Agendada', papel: 'OUTRA', cor: '#00d9ff' },
  { id: 11, label: 'Leads Vencidos ', papel: 'OUTRA' },
  { id: 15, label: 'Com Restrição', papel: 'OUTRA', cor: '#560d6c' },
] as const;

/** Etapa de entrada (coluna amarela) e etapa alvo da automação. */
export const CVRM_ENTRADA = 2;
export const CVRM_ALVO = 4;

export const CVRM_SELECTORS = {
  formSituacao: '#form_situacao',
  situacaoPara: '#situacao_para',
  workflow: '.situacoes-workflow',
  stage: '.status',
  stageAtivo: '.status.ativo',
  kanbanColuna: '.aw-flow-col',
  kanbanHeadLink: '.aw-flow-head a[href*="situacoes"]',
  kanbanLista: '.aw-flow-list',
  kanbanCard: '.cv-card',
  kanbanLeadLink: 'a.lead-lite[data-lead]',
  kanbanTitulo: 'h3',
  kanbanInfoItem: '.cv-card-info-item',
  toastContainer: '#toast-container',
} as const;

export const CVRM_HANDLERS = {
  /** Único caminho aceito. Captura o id e o rótulo do alvo. */
  modificar: /modificarSituacao\(\s*'(\d{1,3})'\s*,\s*'([^']*)'\s*\)/,
  /** Handler do "Descartado": proibido por definição. */
  facebox: /chamaFacebox\s*\(/,
} as const;

/** Caminhos do corretor. O host é do tenant (ex.: abiatar.cvcrm.com.br). */
export const CVRM_PATHS = {
  kanban: '/corretor/comercial/andamentoleads',
  leadAdministrar: '/corretor/comercial/leads/{id}/administrar',
} as const;

export const CVRM_LIMITS = {
  /** Atraso entre detectar e mover: deixa o lead "assentar" no banco. */
  delaySeconds: { min: 0, max: 600, default: 5 },
  /** Idade máxima (desde a primeira vez que vimos o lead) para agir. */
  maxAgeHours: { min: 1, max: 168, default: 2 },
  /**
   * Intervalo de releitura do kanban (detecção ativa). 30s é o mínimo
   * realista de um alarme do Chrome e evita metralhar o CRM.
   */
  pollSeconds: { min: 30, max: 300, default: 30 },
  /** Tempo máximo para a página do lead carregar e liberar o clique. */
  pageLoadTimeoutMs: 25_000,
  /** Tempo máximo para a navegação pós-clique provar a nova etapa. */
  confirmTimeoutMs: 25_000,
  /**
   * Concessão de um movimento apenas armado (ainda sem clique). Cobre o atraso
   * configurado + o carregamento da página; passou disso, o motor morreu no
   * meio e o movimento é encerrado como falha.
   */
  armLeaseMs: 50_000,
  /** Intervalo mínimo entre dois movimentos (mutex de ação). */
  moveCooldownMs: 3_000,
  /** Quantos movimentos ficam no histórico local. */
  maxHistorico: 100,
  /** TTL do arm do `confirm`. Depois disso o clique exige humano de novo. */
  armTtlMs: 30_000,
  /** Janela em que um toast do CRM conta como novidade. */
  toastTtlMs: 60_000,
} as const;
