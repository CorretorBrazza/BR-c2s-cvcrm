import type { LeadStatusLocal } from '../types/lead';

/** Classes de status observadas na lista de leads (01.txt). */
export const C2S_STATUS_CLASSES: Record<string, { label: string; cor?: string }> = {
  under_negotiation: { label: 'Em negociação', cor: '#FF8000' },
  new: { label: 'Novo' },
  pending: { label: 'Pendente' },
  waiting: { label: 'Aguardando' },
  scheduled: { label: 'Visita agendada' },
  finished: { label: 'Finalizado' },
  lost: { label: 'Perdido' },
};

/** Transições locais permitidas — nada fora disso pode ser executado pelo robô. */
export const ALLOWED_LEAD_TRANSITIONS: Record<LeadStatusLocal, LeadStatusLocal[]> = {
  NOVO: ['CAPTURANDO', 'CAPTURADO', 'PERDIDO', 'ERRO', 'CANCELADO'],
  CAPTURANDO: ['CAPTURADO', 'PERDIDO', 'ERRO', 'CANCELADO'],
  CAPTURADO: ['EM_ATENDIMENTO', 'ERRO', 'CANCELADO'],
  PERDIDO: ['NOVO', 'CANCELADO'],
  EM_ATENDIMENTO: ['AGUARDANDO_RESPOSTA', 'MENSAGEM_ENVIADA', 'MENSAGEM_FALHOU', 'ERRO', 'CANCELADO'],
  AGUARDANDO_RESPOSTA: ['MENSAGEM_ENVIADA', 'MENSAGEM_FALHOU', 'EM_ATENDIMENTO', 'ERRO', 'CANCELADO'],
  MENSAGEM_ENVIADA: ['EM_ATENDIMENTO', 'ERRO', 'CANCELADO'],
  MENSAGEM_FALHOU: ['AGUARDANDO_RESPOSTA', 'EM_ATENDIMENTO', 'ERRO', 'CANCELADO'],
  ERRO: ['NOVO', 'CANCELADO'],
  CANCELADO: ['NOVO'],
};

/**
 * Ações que o robô NUNCA executa, independentemente de configuração/licença.
 * (Regras 7, 8, 9, 10 do prompt.)
 */
export const FORBIDDEN_OPERATIONS = [
  'ARCHIVE_LEAD',
  'CLOSE_DEAL',
  'DELETE_LEAD',
  'REDISTRIBUTE_LEAD',
  'CHANGE_OWNER',
] as const;

export type ForbiddenOperation = (typeof FORBIDDEN_OPERATIONS)[number];

/** Motivos de modal de funil que exigem decisão humana. */
export const FUNNEL_MODAL_BLOCKLIST = ['closing', 'archive', 'converted'] as const;

export function isTerminalStatus(status: LeadStatusLocal): boolean {
  return status === 'MENSAGEM_ENVIADA' || status === 'PERDIDO' || status === 'CANCELADO';
}
