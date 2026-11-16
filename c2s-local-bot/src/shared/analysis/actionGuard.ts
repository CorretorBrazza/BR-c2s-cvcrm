import { FEATURE_FLAGS } from '../constants/featureFlags';
import { FORBIDDEN_OPERATIONS, FUNNEL_MODAL_BLOCKLIST, type ForbiddenOperation } from '../constants/statuses';
import type { LicenseState } from '../types/license';

/**
 * Portão único de automação.
 *
 * Nenhuma ação chega ao C2S sem passar por aqui. É lógica pura para poder ser
 * testada e para ser chamada tanto pelo service worker (engine) quanto pelo
 * content script, sem depender de `chrome.*` nem de DOM.
 */

export type GuardedAction =
  | { type: 'CAPTURAR_BOLSAO'; c2sLeadId: string }
  | { type: 'MOVER_FUNIL'; c2sLeadId: string; targetColumnId: string; modalMotivo?: string }
  | { type: 'CRIAR_ATIVIDADE'; c2sLeadId: string }
  | { type: 'ENVIAR_MENSAGEM'; c2sLeadId: string }
  | { type: 'ALTERAR_STATUS'; c2sLeadId: string; status: string }
  | { type: ForbiddenOperation };

export interface GuardContext {
  automationEnabled: boolean;
  calibrationConfirmedAt: string;
  /** Opt-in explícito do corretor. Vazio = negado. */
  optInAt: string;
  botActive: boolean;
  paused: boolean;
  /** Enquanto a inspeção está ligada, nenhuma ação real pode rodar. */
  inspectMode: boolean;
  settings: {
    autoClaimPool: boolean;
    autoMoveToAttendance: boolean;
    autoCreateFollowUp: boolean;
    autoSendMessage: boolean;
  };
  license: LicenseState;
}

export interface GuardDecision {
  allowed: boolean;
  motivo: string;
}

function deny(motivo: string): GuardDecision {
  return { allowed: false, motivo };
}

/**
 * Ordem importa: bloqueios absolutos primeiro, depois build, opt-in,
 * inspeção, calibração, estado do robô e, por último, configuração/licença.
 */
export function evaluateAction(action: GuardedAction | { type: string }, context: GuardContext): GuardDecision {
  if ((FORBIDDEN_OPERATIONS as readonly string[]).includes(action.type)) {
    return deny(`Operação proibida por política: ${action.type}.`);
  }

  if (!FEATURE_FLAGS.automationEnabled || !context.automationEnabled) {
    return deny('Automação desativada neste build (VITE_AUTOMATION_ENABLED=false).');
  }

  if (!context.optInAt) {
    return deny('Opt-in da automação não registrado pelo corretor.');
  }

  if (context.inspectMode) {
    return deny('Modo inspeção ligado: nenhuma ação real é executada enquanto ele estiver ativo.');
  }

  if (!context.calibrationConfirmedAt) {
    return deny('Calibração não confirmada pelo corretor.');
  }

  if (!context.botActive || context.paused) {
    return deny('Robô pausado pelo corretor.');
  }

  switch (action.type) {
    case 'CAPTURAR_BOLSAO':
      if (!context.settings.autoClaimPool) return deny('Captura automática do Bolsão desligada.');
      if (!context.license.payload?.features.bucketCapture) return deny('Licença sem o recurso de captura.');
      return { allowed: true, motivo: 'ok' };

    case 'MOVER_FUNIL': {
      if (!context.settings.autoMoveToAttendance) return deny('Movimentação automática desligada.');
      const modalMotivo = (action as { modalMotivo?: string }).modalMotivo;
      if (modalMotivo && (FUNNEL_MODAL_BLOCKLIST as readonly string[]).includes(modalMotivo)) {
        return deny(`Coluna exige decisão humana (${modalMotivo}).`);
      }
      return { allowed: true, motivo: 'ok' };
    }

    case 'CRIAR_ATIVIDADE':
      if (!context.settings.autoCreateFollowUp) return deny('Criação automática de atividade desligada.');
      if (!context.license.payload?.features.autoActivity) return deny('Licença sem o recurso de atividades.');
      return { allowed: true, motivo: 'ok' };

    case 'ENVIAR_MENSAGEM':
      if (!context.settings.autoSendMessage) return deny('Envio automático de mensagem desligado.');
      if (!context.license.payload?.features.autoMessage) return deny('Licença sem o recurso de mensagens.');
      return { allowed: true, motivo: 'ok' };

    case 'ALTERAR_STATUS':
      if (!context.settings.autoMoveToAttendance) return deny('Alteração automática de status desligada.');
      if (!context.license.payload?.features.autoStatus) return deny('Licença sem o recurso de status.');
      return { allowed: true, motivo: 'ok' };

    default:
      return deny(`Ação desconhecida: ${(action as { type?: string }).type ?? '?'}.`);
  }
}

/**
 * O clique em "abrir WhatsApp" NUNCA conta como interação com o lead.
 * Interação = mensagem enviada pelo C2S (super_reply) ou resposta do cliente.
 */
export function isInteractionEvidence(input: {
  tipo: 'WHATSAPP_CLICK' | 'REPLY_SENT' | 'CUSTOMER_REPLY' | 'MANUAL_MESSAGE';
}): boolean {
  return input.tipo === 'REPLY_SENT' || input.tipo === 'CUSTOMER_REPLY' || input.tipo === 'MANUAL_MESSAGE';
}
