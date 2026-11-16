import { BUILD_INFO } from './buildInfo';

/**
 * Flags de build. A automação só existe quando TODAS as condições valem:
 *   1. `VITE_AUTOMATION_ENABLED=true` no build (padrão: desligado);
 *   2. opt-in explícito do corretor (`automationOptInAt`);
 *   3. calibração confirmada;
 *   4. modo inspeção desligado;
 *   5. licença válida com a feature correspondente;
 *   6. actionGuard aprovar cada ação.
 *
 * `BUILD_INFO` é a fonte única: o painel mostra exatamente o que foi compilado,
 * em vez de repetir o que o `.env` prometia.
 */
export const FEATURE_FLAGS = {
  /** Build de produção normal nasce com isto `false`. */
  automationEnabled: BUILD_INFO.automationEnabled,
  /**
   * Criação de atividade em lead normal só entra depois de uma amostra manual
   * real do modal/POST do C2S. Sem contrato, o executor recusa.
   */
  activityAutomationEnabled: BUILD_INFO.activityAutomationEnabled,
  inspectionEnabled: true,
  telemetryEnabled: false,
  screenshotsEnabled: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isAutomationUnlocked(input: {
  calibrationConfirmedAt: string;
  optInAt: string;
  botActive: boolean;
  paused: boolean;
  inspectMode: boolean;
}): boolean {
  return (
    FEATURE_FLAGS.automationEnabled &&
    Boolean(input.optInAt) &&
    Boolean(input.calibrationConfirmedAt) &&
    input.botActive &&
    !input.paused &&
    !input.inspectMode
  );
}
