export interface Settings {
  botActive: boolean;
  autoClaimPool: boolean;
  autoMoveToAttendance: boolean;
  autoCreateFollowUp: boolean;
  autoSendMessage: boolean;

  poolDelayMinMs: number;
  poolDelayMaxMs: number;
  pollingIntervalMs: number;
  maxRetries: number;
  duplicateProtectionHours: number;

  /** v1 nasce com inspeção ligada até o contrato ser confirmado. */
  inspectMode: boolean;
  inspectCaptureScreenshots: boolean;
  inspectIncludePii: boolean;

  soundAlerts: boolean;
  desktopNotifications: boolean;

  retentionTechnicalLogsDays: number;
  retentionLeadDataDays: number;
  retentionMetricsMonths: number;
  retentionScreenshotsDays: number;
  retentionScreenshotsMaxFiles: number;

  licenseKey: string;
  licenseCheckIntervalHours: number;
  offlineLicenseToleranceHours: number;

  targetAttendanceColumnId: string;
  targetAttendanceFunnelId: string;

  followUpDelayHours: number;
  followUpDescription: string;

  templateDirect: string;
  templatePool: string;

  telemetryEnabled: boolean;

  /** ISO datetime em que o corretor confirmou o contrato de calibração. */
  calibrationConfirmedAt: string;
  calibrationAppFingerprint: string;

  /* ---------------- F3: janela de interação ---------------- */

  /** Quanto tempo um lead do Bolsão tem antes de ser considerado perdido. */
  poolWindowMinutes: number;
  /** Quanto tempo um lead normal tem para receber a atividade. */
  leadWindowMinutes: number;
  /** Ao agir, traz a aba do C2S para frente por alguns segundos. */
  bringTabToFront: boolean;
  /** Opt-in explícito da automação (ISO). Vazio = automação desligada. */
  automationOptInAt: string;

  /* ---------------- CV CRM (mover etapa) ---------------- */

  /** Módulo CV CRM habilitado no painel. */
  cvcrmEnabled: boolean;
  /** Mover lead de "Aguardando Atendimento Corretor" para "Em Atendimento". */
  cvcrmAutoMove: boolean;
  /** Espera entre detectar o lead e clicar (deixa o lead assentar no CRM). */
  cvcrmDelaySeconds: number;
  /** Acima disso (desde a primeira vez que vimos o lead), não move mais. */
  cvcrmMaxAgeHours: number;
  /** `TOAST` = só observa o aviso nativo; `KANBAN` = relê o quadro. */
  cvcrmDetection: 'TOAST' | 'KANBAN';
  cvcrmPollSeconds: number;
  /** Tenant aprendido no primeiro heartbeat (ex.: `abiatar`). */
  cvcrmHost: string;
}

export type SettingsPatch = Partial<Settings>;
