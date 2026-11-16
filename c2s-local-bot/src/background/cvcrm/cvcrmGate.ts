import { FEATURE_FLAGS } from '../../shared/constants/featureFlags';
import type { CvRequirement, CvState } from '../../shared/types/cvcrm';
import type { LicenseStatus } from '../../shared/types/license';
import type { Settings } from '../../shared/types/settings';
import { licenseService } from '../license/licenseService';

/**
 * Gate do módulo CV CRM.
 *
 * Mesmo espírito do gate do C2S: qualquer dúvida bloqueia. A calibração do C2S
 * NÃO entra aqui — o contrato do CV CRM foi lido de páginas reais (painel,
 * kanban e HAR do POST), não de uma amostra pendente.
 *
 * A lista é **estruturada** de propósito: o painel mostra requisito por
 * requisito (✓/✗) em vez de um "Bloqueado" sem explicação. `motivosCvcrm` é
 * derivado dela, então as duas telas nunca discordam.
 */
export function requisitosCvcrm(
  settings: Settings,
  state: CvState,
  licenca: LicenseStatus = licenseService.getState().status,
): CvRequirement[] {
  const licencaOk = licenca === 'VALIDA' || licenca === 'TOLERANCIA_OFFLINE';

  const lista: CvRequirement[] = [
    {
      chave: 'BUILD',
      label: 'Build com automação',
      ok: FEATURE_FLAGS.automationEnabled,
      motivo: 'Build sem automação (VITE_AUTOMATION_ENABLED=false).',
    },
    {
      chave: 'OPT_IN',
      label: 'Opt-in da automação',
      ok: Boolean(settings.automationOptInAt),
      motivo: 'Opt-in da automação não registrado.',
    },
    {
      chave: 'ROBO',
      label: 'Robô ativo',
      ok: settings.botActive,
      motivo: 'Robô pausado pelo corretor.',
    },
    {
      chave: 'INSPECAO',
      label: 'Modo inspeção desligado',
      ok: !settings.inspectMode,
      motivo: 'Modo inspeção ligado.',
    },
    {
      chave: 'LICENCA',
      label: 'Licença válida',
      ok: licencaOk,
      motivo: `Licença: ${licenca}.`,
    },
    {
      chave: 'MODULO',
      label: 'Módulo CV CRM ligado',
      ok: settings.cvcrmEnabled,
      motivo: 'Módulo CV CRM desligado.',
    },
    {
      chave: 'MOVER',
      label: 'Mover etapa ligado',
      ok: settings.cvcrmAutoMove,
      motivo: 'Mover etapa desligado.',
    },
    {
      chave: 'BASELINE',
      label: 'Linha de base definida',
      ok: Boolean(state.baselineEm),
      motivo: 'Linha de base não definida.',
    },
  ];

  return lista;
}

export function motivosCvcrm(
  settings: Settings,
  state: CvState,
  licenca: LicenseStatus = licenseService.getState().status,
): string[] {
  return requisitosCvcrm(settings, state, licenca)
    .filter((requisito) => !requisito.ok)
    .map((requisito) => requisito.motivo ?? requisito.label);
}

export function cvcrmLiberado(settings: Settings, state: CvState): boolean {
  return motivosCvcrm(settings, state).length === 0;
}
