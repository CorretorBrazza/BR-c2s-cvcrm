/**
 * Janela de interação por lead.
 *
 * O produto não é "capturar do Bolsão": é agir dentro do prazo de cada lead que
 * chega. Todo lead — do pool ou normal — ganha um `LeadWindow` com prazo, estado
 * e histórico. O Bolsão é só o caso de prazo mais curto e mais disputado.
 */
import type { PageContext } from './inspection';

export type LeadOrigin = 'POOL' | 'NORMAL';

export type LeadWindowState =
  /** Visto na página, ainda sem ação disparada. */
  | 'DETECTADO'
  /** Aguardando a vez na fila (prioridade/prazo/backoff). */
  | 'ACAO_PENDENTE'
  /** Ação executada no C2S (captura ou atividade), aguardando interação. */
  | 'ACAO_EXECUTADA'
  /** Interação confirmada: janela encerrada com sucesso. */
  | 'INTERACAO_CONFIRMADA'
  /** Guard/contrato/sessão impediram a ação. Pode voltar a ser tentada. */
  | 'BLOQUEADO'
  /** O prazo venceu antes de qualquer ação. Vira métrica, não lixo. */
  | 'EXPIRADO'
  /** Erro definitivo. Não é retentado. */
  | 'FALHA';

export type LeadWindowAction = 'CAPTURAR_BOLSAO' | 'CRIAR_ATIVIDADE';

export type Confidence = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface LeadWindow {
  id: string;
  c2sLeadId: string;
  origem: LeadOrigin;
  acao: LeadWindowAction;
  estado: LeadWindowState;
  detectadoEm: string;
  prazoEm: string;
  tentativas: number;
  /** Backoff: a janela só volta a ser elegível depois disso. */
  proximaTentativaEm?: string;
  ultimaTentativaEm?: string;
  /** Motivo do bloqueio atual (guard, contrato, sessão). */
  bloqueio?: string;
  /** `false` = bloqueio definitivo (ex.: contrato não calibrado). */
  bloqueioRetentavel?: boolean;
  ultimoErro?: string;
  interacaoConfirmadaEm?: string;
  confianca: Confidence;
  nome?: string;
  atualizadoEm: string;
}

export interface WindowCandidate {
  c2sLeadId: string;
  origem: LeadOrigin;
  nome?: string;
  /** Data exibida na listagem/card. Só entra se realmente foi lida do DOM. */
  criadoEm?: string;
  /**
   * Prazo restante publicado pelo próprio C2S (`.bucket-time`, `data-seconds`).
   * Quando existe, é a fonte de verdade do fim da janela.
   */
  segundosRestantes?: number;
  confianca: Confidence;
}

/** O que o content script consegue provar sobre a página agora. */
export interface WindowProbeResult {
  abaC2s: boolean;
  contexto: PageContext;
  url: string;
  bucketVisivel: boolean;
  /** O C2S bloqueia captura por free tier (valor de `#free_tier_enabled`). */
  freeTier: boolean;
  /** O próprio C2S bloqueia captura por limite do Bolsão atingido. */
  bolsaoPausado: boolean;
  pool: WindowCandidate[];
  normal: WindowCandidate[];
  /** A lista de contatos renderizou (mesmo que vazia). */
  listaNormalVisivel: boolean;
  /**
   * Quantos leads o C2S diz que há no Bolsão (`#badged_bolsao`). Serve para
   * detectar seletor quebrado: se ele indica leads e o parser achou zero, o DOM
   * mudou. `undefined` = o C2S não publicou contagem.
   */
  bolsaoIndicado?: number;
  observacoes: string[];
}

/** Resultado de um passo executado no content script. */
export interface WindowActionResult {
  ok: boolean;
  /** Código estável, nunca texto livre da página. */
  motivo: string;
  etapa: 'card' | 'modal' | 'confirmacao' | 'contrato' | 'aba';
  /** Se `false`, não tenta de novo (evita POST duplo). */
  retentavel: boolean;
  duracaoMs: number;
  urlFinal?: string;
}

export interface PoolPauseState {
  pausado: boolean;
  motivo?: string;
  janelaId?: string;
  c2sLeadId?: string;
}

export type WindowStats = Record<LeadWindowState, number>;

export interface WindowsOverview {
  janelas: LeadWindow[];
  stats: WindowStats;
  poolPausado: PoolPauseState;
  ultimoTickEm?: string;
  /** A aba do C2S respondeu ao último probe? */
  abaRespondeu: boolean;
  /** Automação liberada por build + opt-in + calibração + licença. */
  automacaoLiberada: boolean;
  motivosBloqueio: string[];
  /** Observações do último tick que não impedem a automação, mas importam. */
  avisos: string[];
}

export interface WindowTiming {
  poolMinutes: number;
  leadMinutes: number;
}

/** Evidência aceita para encerrar a pausa do Bolsão. Clique em WhatsApp nunca conta. */
export type WindowInteractionEvidence = 'SUPER_REPLY' | 'MANUAL';

/** Estado do último tick — o painel lê daqui sem precisar sondar a aba. */
export interface WindowTickMeta {
  ultimoTickEm: string;
  abaRespondeu: boolean;
  motivosBloqueio: string[];
  avisos: string[];
  poolPausado: PoolPauseState;
}

/* ------------------------------------------------------------------ */
/* Protocolo SW -> content script                                      */
/* ------------------------------------------------------------------ */

export type WindowContentRequest =
  | { kind: 'window:probe'; id: string; payload: Record<string, never> }
  | { kind: 'window:audit'; id: string; payload: Record<string, never> }
  | { kind: 'window:capture'; id: string; payload: { c2sLeadId: string; atrasoMinMs: number; atrasoMaxMs: number } }
  | { kind: 'window:activity'; id: string; payload: { c2sLeadId: string } };
