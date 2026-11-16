export type EventLevel = 'INFO' | 'AVISO' | 'ERRO';

export type EventOrigin = 'EXTENSION' | 'PAGINA' | 'PAINEL' | 'SISTEMA' | 'INSPECAO';

export type EventType =
  | 'EXTENSION_STARTED'
  | 'EXTENSION_STOPPED'
  | 'EXTENSION_UPDATED'
  | 'C2S_PAGE_DETECTED'
  | 'C2S_SESSION_VALID'
  | 'C2S_SESSION_EXPIRED'
  | 'BUCKET_PAGE_DETECTED'
  | 'BUCKET_LEADS_RESPONSE_RECEIVED'
  | 'BUCKET_LEAD_DETECTED'
  | 'BUCKET_LEAD_DUPLICATED'
  | 'BUCKET_LIMIT_DETECTED'
  | 'CAPTURE_STARTED'
  | 'CAPTURE_CLICKED'
  | 'CAPTURE_RESPONSE_RECEIVED'
  | 'CAPTURE_SUCCESS'
  | 'CAPTURE_FAILED'
  | 'CAPTURE_LOST_TO_COMPETITOR'
  | 'LEAD_V2_RESPONSE_RECEIVED'
  | 'LEAD_DETECTED'
  | 'LEAD_DETAIL_OPENED'
  | 'LEAD_DATA_EXTRACTED'
  | 'LEAD_STATUS_CHANGED'
  | 'FUNNEL_MOVE_STARTED'
  | 'FUNNEL_MOVE_SUCCESS'
  | 'FUNNEL_MOVE_FAILED'
  | 'ACTIVITY_CREATE_STARTED'
  | 'ACTIVITY_CREATE_SUCCESS'
  | 'ACTIVITY_CREATE_FAILED'
  | 'REPLY_STARTED'
  | 'REPLY_SENT'
  | 'REPLY_FAILED'
  | 'WHATSAPP_CLICK_REGISTERED'
  | 'LICENSE_VALIDATED'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_INVALID'
  | 'INTERNAL_ERROR'
  | 'USER_PAUSED'
  | 'USER_RESUMED'
  | 'SETTINGS_UPDATED'
  | 'EXPORT_GENERATED'
  | 'INSPECT_MODE_ENABLED'
  | 'INSPECT_MODE_DISABLED'
  | 'INSPECT_NETWORK_SAMPLE'
  | 'INSPECT_DOM_SAMPLE'
  | 'INSPECT_SELECTOR_PROFILE'
  | 'INSPECT_SCREENSHOT'
  | 'CALIBRATION_IMPORTED'
  | 'CALIBRATION_CONFIRMED'
  | 'DATA_CLEARED'
  | 'ACTION_QUEUED'
  | 'ACTION_STARTED'
  | 'ACTION_FINISHED'
  | 'RETENTION_CLEANUP'
  /* ---------------- F3: janela de interação ---------------- */
  | 'WINDOW_DETECTED'
  | 'WINDOW_EXPIRED'
  | 'WINDOW_BLOCKED'
  | 'POOL_PAUSED'
  | 'INTERACTION_CONFIRMED'
  | 'SUSPENSION_DETECTED'
  /** O C2S indicou leads no Bolsão e o parser não achou nenhum: layout mudou. */
  | 'SELETOR_SUSPEITO'
  /* ---------------- CV CRM ---------------- */
  | 'CVRM_PAGE_DETECTED'
  | 'CVRM_LEAD_DETECTED'
  | 'CVRM_MOVE_STARTED'
  | 'CVRM_MOVE_CONFIRMED'
  | 'CVRM_MOVE_FAILED'
  | 'CVRM_MOVE_BLOCKED'
  | 'CVRM_BASELINE_SET'
  | 'CVRM_SELECTOR_SUSPEITO';

export interface EventLogRecord {
  id: string;
  correlationId: string;
  leadId?: string;
  c2sLeadId?: string;
  tipoEvento: EventType;
  nivel: EventLevel;
  origem: EventOrigin;
  endpoint?: string;
  metodoHttp?: string;
  statusHttp?: number;
  payloadEnviado?: unknown;
  respostaRecebida?: unknown;
  payloadResumido?: string;
  respostaResumida?: string;
  seletorUsado?: string;
  acaoExecutada?: string;
  resultado?: string;
  motivo?: string;
  duracaoMs?: number;
  criadoEm: string;
  extensaoVersao: string;
  contexto?: Record<string, unknown>;
}

export type NewEventLog = Omit<EventLogRecord, 'id' | 'criadoEm' | 'extensaoVersao' | 'correlationId'> &
  Partial<Pick<EventLogRecord, 'id' | 'criadoEm' | 'extensaoVersao' | 'correlationId'>>;
