import type { CalibrationBundle, CalibrationContract, CalibrationReadiness, DomSample, InspectionStatus, NetworkSample, PageContext, SelectorProfile } from './inspection';import type { SettingsPatch } from './settings';
import type { EventLogRecord } from './eventLog';
import type { DailyMetrics, MonthlyMetrics } from './metrics';
import type { LeadRecord } from './lead';
import type { LicenseState } from './license';
import type { WindowsOverview } from './window';
import type { SelectorAuditReport } from './audit';
import type { CvContext, CvKanbanLead, CvOverview } from './cvcrm';

/* ------------------------------------------------------------------ */
/* Consultas do painel                                                 */
/* ------------------------------------------------------------------ */

export interface LogFilters {
  tipoEvento?: string;
  nivel?: string;
  origem?: string;
  resultado?: string;
  leadId?: string;
  desde?: string;
  ate?: string;
  busca?: string;
}

export interface LeadFilters {
  statusLocal?: string;
  origemTipo?: string;
  resultado?: string;
  busca?: string;
  desde?: string;
  ate?: string;
}

export type DataQuery =
  | { type: 'settings' }
  | { type: 'logs'; limit?: number; filters?: LogFilters }
  | { type: 'leads'; limit?: number; filters?: LeadFilters }
  | { type: 'lead'; id: string }
  | { type: 'metrics' }
  | { type: 'metrics:daily'; desde: string; ate: string }
  | { type: 'inspection:status' }
  | { type: 'inspection:samples'; kind?: 'network' | 'dom' | 'selectors'; limit?: number }
  | { type: 'calibration:readiness' }
  | { type: 'calibration:contract' }
  | { type: 'license' }
  | { type: 'session' }
  | { type: 'connection' }
  | { type: 'templates' }
  | { type: 'windows' }
  | { type: 'windows:audit' }
  | { type: 'cvcrm' };

export interface PanelQueryResultMap {
  settings: unknown;
  logs: EventLogRecord[];
  leads: LeadRecord[];
  lead: LeadRecord | null;
  metrics: { hoje: DailyMetrics; mes: MonthlyMetrics };
  'metrics:daily': DailyMetrics[];
  'inspection:status': InspectionStatus;
  'inspection:samples': Array<NetworkSample | DomSample | SelectorProfile>;
  'calibration:readiness': CalibrationReadiness;
  'calibration:contract': CalibrationContract;
  license: LicenseState;
  session: { conectado: boolean; contexto: PageContext; url?: string; atualizadoEm?: string };
  connection: { conectado: boolean; abaC2sAberta: boolean; ultimoPingEm?: string };
  templates: unknown[];
  windows: WindowsOverview;
  'windows:audit': SelectorAuditReport;
  cvcrm: CvOverview;
}

/* ------------------------------------------------------------------ */
/* Mensagens runtime                                                   */
/* ------------------------------------------------------------------ */

export type RuntimeMessage =
  | { kind: 'ping'; id: string }
  | { kind: 'panel:query'; id: string; payload: DataQuery }
  | { kind: 'settings:update'; id: string; payload: SettingsPatch }
  | { kind: 'bot:toggle'; id: string; payload: { active: boolean } }
  | { kind: 'inspection:set'; id: string; payload: { enabled: boolean } }
  | { kind: 'inspection:screenshot:request'; id: string }
  | { kind: 'inspection:capture-dom'; id: string }
  | { kind: 'inspection:profile-selectors'; id: string }
  | { kind: 'calibration:export'; id: string; payload: { includePii: boolean } }
  | { kind: 'calibration:import'; id: string; payload: { bundle: CalibrationBundle } }
  | { kind: 'calibration:confirm'; id: string }
  | { kind: 'data:clear'; id: string; payload: { scope: 'inspection' | 'logs' | 'all' } }
  | { kind: 'template:save'; id: string; payload: { templateId?: string; nome: string; tipo: 'DIRETO' | 'BOLSAO' | 'FOLLOWUP'; conteudo: string } }
  | { kind: 'template:delete'; id: string; payload: { templateId: string } }
  | { kind: 'insp:network'; id: string; payload: NetworkSample[] }
  | { kind: 'insp:dom'; id: string; payload: DomSample }
  | { kind: 'insp:selectors'; id: string; payload: SelectorProfile }
  | { kind: 'insp:screenshot'; id: string; payload: { dataUrl: string; context: PageContext; url: string } }
  | { kind: 'page:context'; id: string; payload: { context: PageContext; url: string; title: string; sessaoValida: boolean } }
  | { kind: 'page:heartbeat'; id: string; payload: { context: PageContext; url: string; sessaoValida: boolean } }
  | { kind: 'windows:tick'; id: string }
  | { kind: 'windows:interaction'; id: string; payload: { c2sLeadId: string; evidencia: 'SUPER_REPLY' | 'MANUAL' } }
  | { kind: 'windows:clear'; id: string; payload: { scope: 'terminal' | 'all' } }
  | { kind: 'windows:signal'; id: string; payload: { c2sLeadId?: string; url?: string } }
  | { kind: 'log:event'; id: string; payload: { tipoEvento: string; nivel?: 'INFO' | 'AVISO' | 'ERRO'; origem?: string; endpoint?: string; metodoHttp?: string; statusHttp?: number; resultado?: string; motivo?: string; seletorUsado?: string; acaoExecutada?: string; duracaoMs?: number; c2sLeadId?: string; contexto?: Record<string, unknown> } }
  | { kind: 'cvcrm:page'; id: string; payload: { context: CvContext; url: string; leadId?: string; atual?: number } }
  | { kind: 'cvcrm:kanban'; id: string; payload: { host: string; url: string; leads: CvKanbanLead[]; toasts?: string[] } }
  | { kind: 'cvcrm:executar'; id: string; payload: { leadId: string; inspectMode?: boolean } }
  | { kind: 'cvcrm:scan'; id: string }
  | { kind: 'cvcrm:baseline'; id: string }
  | { kind: 'cvcrm:tick'; id: string }
  | { kind: 'cvcrm:reset'; id: string };

export type RuntimeMessageKind = RuntimeMessage['kind'];

export const RUNTIME_MESSAGE_KINDS: RuntimeMessageKind[] = [
  'ping',
  'panel:query',
  'settings:update',
  'bot:toggle',
  'inspection:set',
  'inspection:screenshot:request',
  'inspection:capture-dom',
  'inspection:profile-selectors',
  'calibration:export',
  'calibration:import',
  'calibration:confirm',
  'data:clear',
  'template:save',
  'template:delete',
  'insp:network',
  'insp:dom',
  'insp:selectors',
  'insp:screenshot',
  'page:context',
  'page:heartbeat',
  'windows:tick',
  'windows:interaction',
  'windows:clear',
  'windows:signal',
  'log:event',
  'cvcrm:page',
  'cvcrm:kanban',
  'cvcrm:executar',
  'cvcrm:scan',
  'cvcrm:baseline',
  'cvcrm:tick',
  'cvcrm:reset',
];

export type RuntimeResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface LiveEventMessage {
  type: 'event';
  payload: EventLogRecord;
}

export interface LiveStatusMessage {
  type: 'status';
  payload: {
    status: string;
    botActive: boolean;
    inspectMode: boolean;
    conectado: boolean;
    atualizadoEm: string;
  };
}

export interface LiveInspectionMessage {
  type: 'inspection';
  payload: { counts: Record<string, number>; ultimaAmostraEm?: string };
}

export type LiveMessage = LiveEventMessage | LiveStatusMessage | LiveInspectionMessage;
