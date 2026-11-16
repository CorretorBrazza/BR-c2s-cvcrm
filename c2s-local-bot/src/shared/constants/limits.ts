/** Limites técnicos e operacionais. */
export const LIMITS = {
  /** Corpo máximo de request/response gravado no modo inspeção. */
  maxNetworkBodyBytes: 512 * 1024,
  /** HTML máximo por amostra de DOM. */
  maxDomBytes: 1.5 * 1024 * 1024,
  /** Limite de itens por consulta no painel. */
  maxQueryLimit: 500,
  /** Janela de deduplicação de amostras de rede. */
  networkDedupeWindowMs: 5_000,
  /** Intervalo mínimo entre screenshots (chrome limita ~2/s). */
  screenshotMinIntervalMs: 600,
  /** Polling permitido. */
  pollingMinMs: 2_000,
  pollingMaxMs: 10_000,
  pollingDefaultMs: 3_000,
  /** Delay de captura no Bolsão. */
  poolDelayMinMs: 300,
  poolDelayMaxMs: 900,
  /** Retry. */
  maxRetries: 3,
  retryBaseMs: 1_000,
  retryMaxMs: 30_000,
  /** Retenções padrão (dias/meses). */
  retentionTechnicalLogsDays: 30,
  retentionLeadDataDays: 90,
  retentionMetricsMonths: 12,
  retentionScreenshotsDays: 7,
  retentionScreenshotsMaxFiles: 200,
  /** Heartbeat do content script -> service worker. */
  heartbeatIntervalMs: 15_000,
  /** Aba C2S sem heartbeat por esse tempo = aba fechada/inativa. */
  heartbeatStaleMs: 45_000,
  /**
   * Mínimo de amostras para considerar um endpoint calibrado (F2).
   * `capturePost` é referência: a prontidão trata o POST como "a confirmar"
   * (contrato derivado do script) até a primeira captura real.
   */
  calibrationMinSamples: {
    bucketListResponse: 1,
    leadsV2Response: 1,
    captureGet: 1,
    capturePost: 1,
    leadDetailPage: 1,
    contactsListPage: 1,
    bucketPage: 1,
    domSamples: 2,
    selectorProfiles: 1,
  },
} as const;

export const STORAGE_KEYS = {
  settings: 'settings',
  license: 'license',
  calibration: 'calibration',
  session: 'session',
  botState: 'botState',
} as const;
