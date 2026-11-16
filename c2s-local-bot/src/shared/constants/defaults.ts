import type { Settings } from '../types/settings';
import { LIMITS } from './limits';

export const APP_VERSION = '1.0.0';
export const APP_NAME = 'C2S Local Bot';

export const DEFAULT_SETTINGS: Settings = {
  botActive: true,

  // Automação nasce desligada: só é liberada depois do contrato de calibração (F3/F4).
  autoClaimPool: false,
  autoMoveToAttendance: false,
  autoCreateFollowUp: false,
  autoSendMessage: false,

  poolDelayMinMs: LIMITS.poolDelayMinMs,
  poolDelayMaxMs: LIMITS.poolDelayMaxMs,
  pollingIntervalMs: LIMITS.pollingDefaultMs,
  maxRetries: LIMITS.maxRetries,
  duplicateProtectionHours: 12,

  // v1 nasce em modo inspeção até o corretor confirmar o contrato.
  inspectMode: true,
  inspectCaptureScreenshots: true,
  inspectIncludePii: false,

  soundAlerts: true,
  desktopNotifications: true,

  retentionTechnicalLogsDays: LIMITS.retentionTechnicalLogsDays,
  retentionLeadDataDays: LIMITS.retentionLeadDataDays,
  retentionMetricsMonths: LIMITS.retentionMetricsMonths,
  retentionScreenshotsDays: LIMITS.retentionScreenshotsDays,
  retentionScreenshotsMaxFiles: LIMITS.retentionScreenshotsMaxFiles,

  licenseKey: '',
  licenseCheckIntervalHours: 6,
  offlineLicenseToleranceHours: 48,

  targetAttendanceColumnId: '',
  targetAttendanceFunnelId: '',

  followUpDelayHours: 24,
  followUpDescription: 'Retornar para o cliente',

  templateDirect:
    'Olá {nome}, tudo bem? Vi aqui seu interesse em {imovel}. Posso te passar mais detalhes?',
  templatePool:
    'Olá {nome}, tudo bem? Acabei de receber seu contato sobre {imovel}. Como posso te ajudar?',

  telemetryEnabled: false,

  calibrationConfirmedAt: '',
  calibrationAppFingerprint: '',

  // F3: janela de interação. Bolsão é corrida (curto); lead normal é prazo.
  poolWindowMinutes: 3,
  leadWindowMinutes: 30,
  bringTabToFront: true,
  automationOptInAt: '',

  // CV CRM: módulo e automação nascem desligados. Só mover, nunca arquivar.
  cvcrmEnabled: false,
  cvcrmAutoMove: false,
  cvcrmDelaySeconds: 5,
  cvcrmMaxAgeHours: 2,
  cvcrmDetection: 'TOAST',
  cvcrmPollSeconds: 30,
  cvcrmHost: '',
};

export const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-direct',
    nome: 'Primeiro contato (lead direto)',
    tipo: 'DIRETO' as const,
    conteudo: DEFAULT_SETTINGS.templateDirect,
    variaveis: ['nome', 'imovel', 'telefone', 'origem', 'corretor', 'imobiliaria', 'data'],
    ativo: true,
    criadoEm: '',
    atualizadoEm: '',
  },
  {
    id: 'tpl-pool',
    nome: 'Primeiro contato (Bolsão)',
    tipo: 'BOLSAO' as const,
    conteudo: DEFAULT_SETTINGS.templatePool,
    variaveis: ['nome', 'imovel', 'telefone', 'origem', 'corretor', 'imobiliaria', 'data'],
    ativo: true,
    criadoEm: '',
    atualizadoEm: '',
  },
];

export interface PanelNavItem {
  path: string;
  label: string;
}

export interface PanelNavGroup {
  grupo: string;
  itens: PanelNavItem[];
}

/**
 * Navegação do painel.
 *
 * O produto tem dois motores com o mesmo peso — **C2S** (Bolsão e leads) e
 * **CV CRM** (mover etapa). A navegação reflete isso: "Visão geral" mostra os
 * dois lado a lado e cada um tem a sua própria seção. O que é infraestrutura
 * compartilhada (licença, inspeção, logs, configurações) fica em "Sistema".
 */
export const PANEL_NAV: readonly PanelNavGroup[] = [
  { grupo: '', itens: [{ path: 'dashboard', label: 'Visão geral' }] },
  {
    grupo: 'C2S',
    itens: [
      { path: 'windows', label: 'Janelas' },
      { path: 'leads', label: 'Leads' },
      { path: 'metrics', label: 'Métricas' },
      { path: 'templates', label: 'Templates' },
    ],
  },
  {
    grupo: 'CV CRM',
    itens: [{ path: 'cvcrm', label: 'Mover etapa' }],
  },
  {
    grupo: 'Sistema',
    itens: [
      { path: 'logs', label: 'Logs' },
      { path: 'inspection', label: 'Inspeção' },
      { path: 'settings', label: 'Configurações' },
      { path: 'license', label: 'Licença' },
      { path: 'diagnostics', label: 'Diagnóstico' },
    ],
  },
];

/** Lista plana (validação de rota no `useHashRoute`). */
export const PANEL_ROUTES: readonly PanelNavItem[] = PANEL_NAV.flatMap((grupo) => grupo.itens);
