import { evaluateAction, type GuardDecision, type GuardedAction } from '../../shared/analysis/actionGuard';
import { FEATURE_FLAGS } from '../../shared/constants/featureFlags';
import type { Settings } from '../../shared/types/settings';
import { licenseService } from '../license/licenseService';
import { settingsRepository } from '../storage/repositories/settingsRepository';

/**
 * Liga a configuração real do corretor ao guard puro.
 *
 * O engine nunca decide sozinho: ele pergunta aqui antes de cada ação.
 */

export function motivosDeBloqueio(settings: Settings): string[] {
  const motivos: string[] = [];
  if (!FEATURE_FLAGS.automationEnabled) {
    motivos.push('Build sem automação (VITE_AUTOMATION_ENABLED=false).');
  }
  if (!settings.automationOptInAt) motivos.push('Opt-in da automação não registrado.');
  if (!settings.calibrationConfirmedAt) motivos.push('Calibração não confirmada.');
  if (!settings.botActive) motivos.push('Robô pausado pelo corretor.');
  if (settings.inspectMode) motivos.push('Modo inspeção ligado.');
  const license = licenseService.getState();
  if (license.status !== 'VALIDA' && license.status !== 'TOLERANCIA_OFFLINE') {
    motivos.push(`Licença: ${license.status}.`);
  }
  return motivos;
}

export function automacaoLiberada(settings: Settings): boolean {
  return motivosDeBloqueio(settings).length === 0;
}

export function buildGuardContext(settings: Settings) {
  return {
    automationEnabled: Boolean(settings.automationOptInAt),
    calibrationConfirmedAt: settings.calibrationConfirmedAt,
    optInAt: settings.automationOptInAt,
    botActive: settings.botActive,
    paused: !settings.botActive,
    inspectMode: settings.inspectMode,
    settings: {
      autoClaimPool: settings.autoClaimPool,
      autoMoveToAttendance: settings.autoMoveToAttendance,
      autoCreateFollowUp: settings.autoCreateFollowUp,
      autoSendMessage: settings.autoSendMessage,
    },
    license: licenseService.getState(),
  };
}

export async function gateForAction(action: GuardedAction): Promise<GuardDecision> {
  const settings = await settingsRepository.get();
  return evaluateAction(action, buildGuardContext(settings));
}
