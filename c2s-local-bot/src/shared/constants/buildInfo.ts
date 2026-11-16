/**
 * O que ESTE build realmente contém.
 *
 * Existe porque a diferença entre "automação ligada no `.env`" e "automação
 * embutida no pacote" já custou caro: um build sem chave pública compila um
 * pacote que recusa toda licença e nunca age — e nada na interface avisava.
 *
 * Aqui a verdade do bundle fica legível pelo painel (Diagnóstico) e pelo log de
 * inicialização, sem depender de interpretar código minificado.
 */

const publicKeyRaw = (import.meta.env.VITE_LICENSE_PUBLIC_KEY ?? '').trim();
const automationEnabled = import.meta.env.VITE_AUTOMATION_ENABLED === 'true';

export type LicenseKeyFormat = 'pem' | 'raw32' | 'ausente';

function keyFormat(value: string): LicenseKeyFormat {
  if (!value) return 'ausente';
  return value.includes('BEGIN PUBLIC KEY') ? 'pem' : 'raw32';
}

export const BUILD_INFO = {
  automationEnabled,
  /** Criação de atividade só entra com contrato calibrado (ver activityExecutor). */
  activityAutomationEnabled: false,
  licenseKeyConfigured: publicKeyRaw.length > 0,
  licenseKeyFormat: keyFormat(publicKeyRaw),
  env: import.meta.env.VITE_APP_ENV ?? 'production',
} as const;

/** Chave pública configurada neste build. Vazio = nenhuma licença valida. */
export const LICENSE_PUBLIC_KEY = publicKeyRaw;

/**
 * Marca exclusiva do build, usada por `scripts/build.mjs` para provar que a
 * flag sobreviveu ao bundler. O bundler resolve o ternário em tempo de build e
 * descarta o outro ramo, então só uma das duas strings existe no pacote.
 */
export const BUILD_MARKER = automationEnabled ? 'c2s:automation=on' : 'c2s:automation=off';

/** Texto curto e estável: usado no log de inicialização e no Diagnóstico. */
export function buildSummary(): string {
  return [
    `automação: ${BUILD_INFO.automationEnabled ? 'ligada' : 'desligada'}`,
    `licença: ${
      BUILD_INFO.licenseKeyConfigured
        ? `chave ${BUILD_INFO.licenseKeyFormat}`
        : 'sem chave pública (nenhuma licença valida)'
    }`,
    `ambiente: ${BUILD_INFO.env}`,
  ].join(' · ');
}
