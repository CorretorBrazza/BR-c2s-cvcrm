export type ActionStatus = 'PENDENTE' | 'EXECUTANDO' | 'SUCESSO' | 'FALHA' | 'CANCELADO' | 'RETRY';

export type ActionType =
  | 'DETECTAR_LEAD'
  | 'CAPTURAR_BOLSAO'
  | 'MOVER_FUNIL'
  | 'ALTERAR_STATUS'
  | 'CRIAR_ATIVIDADE'
  | 'ENVIAR_MENSAGEM'
  | 'REGISTRAR_INTERACAO'
  | 'VALIDAR_SESSAO'
  | 'SINCRONIZAR_ESTADO';

export interface LeadActionRecord {
  id: string;
  leadId?: string;
  c2sLeadId?: string;
  tipo: ActionType;
  status: ActionStatus;
  tentativa: number;
  maxTentativas: number;
  payload?: unknown;
  resposta?: unknown;
  erro?: string;
  iniciadoEm?: string;
  finalizadoEm?: string;
  duracaoMs?: number;
  resultado?: string;
  criadoEm: string;
  atualizadoEm: string;
}

export interface QueueEntry {
  actionId: string;
  tipo: ActionType;
  c2sLeadId?: string;
  prioridade: number;
  criadoEm: string;
}
