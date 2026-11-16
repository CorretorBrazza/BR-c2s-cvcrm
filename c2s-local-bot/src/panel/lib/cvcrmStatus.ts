import type { CvMoveState } from '../../shared/types/cvcrm';

/** Rótulos e tons dos estados de movimento — usados pelo Dashboard e pelo CV CRM. */
export const ESTADO_MOVIMENTO: Record<CvMoveState, string> = {
  PENDENTE: 'Pendente',
  ARMADO: 'Abrindo aba',
  CLICADO: 'Clique enviado',
  CONFIRMADO: 'Confirmado',
  FALHA: 'Falha',
  BLOQUEADO: 'Bloqueado',
};

export type TomBadge = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

export const TOM_MOVIMENTO: Record<CvMoveState, TomBadge> = {
  PENDENTE: 'slate',
  ARMADO: 'blue',
  CLICADO: 'violet',
  CONFIRMADO: 'green',
  FALHA: 'red',
  BLOQUEADO: 'amber',
};
