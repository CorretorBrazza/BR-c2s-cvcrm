import type { CalibrationCounts } from '../../shared/types/inspection';

export interface StoreDefinition {
  name: string;
  keyPath: string;
  indexes?: Array<{ name: string; keyPath: string | string[]; unique?: boolean }>;
}

export interface Migration {
  version: number;
  stores: StoreDefinition[];
}

const LEADS: StoreDefinition = {
  name: 'leads',
  keyPath: 'id',
  indexes: [
    { name: 'c2sLeadId', keyPath: 'c2sLeadId', unique: true },
    { name: 'c2sUuid', keyPath: 'c2sUuid' },
    { name: 'statusLocal', keyPath: 'statusLocal' },
    { name: 'origem', keyPath: 'origemTipo' },
    { name: 'detectadoEm', keyPath: 'detectadoEm' },
    { name: 'capturadoEm', keyPath: 'capturadoEm' },
    { name: 'resultado', keyPath: 'resultado' },
  ],
};

const EVENT_LOGS: StoreDefinition = {
  name: 'event_logs',
  keyPath: 'id',
  indexes: [
    { name: 'leadId', keyPath: 'leadId' },
    { name: 'tipoEvento', keyPath: 'tipoEvento' },
    { name: 'nivel', keyPath: 'nivel' },
    { name: 'origem', keyPath: 'origem' },
    { name: 'resultado', keyPath: 'resultado' },
    { name: 'criadoEm', keyPath: 'criadoEm' },
    { name: 'correlationId', keyPath: 'correlationId' },
  ],
};

const LEAD_ACTIONS: StoreDefinition = {
  name: 'lead_actions',
  keyPath: 'id',
  indexes: [
    { name: 'leadId', keyPath: 'leadId' },
    { name: 'tipo', keyPath: 'tipo' },
    { name: 'status', keyPath: 'status' },
    { name: 'iniciadoEm', keyPath: 'iniciadoEm' },
  ],
};

const TEMPLATES: StoreDefinition = {
  name: 'templates',
  keyPath: 'id',
  indexes: [
    { name: 'tipo', keyPath: 'tipo' },
    { name: 'ativo', keyPath: 'ativo' },
  ],
};

const SETTINGS: StoreDefinition = {
  name: 'settings',
  keyPath: 'chave',
};

const DAILY_METRICS: StoreDefinition = {
  name: 'daily_metrics',
  keyPath: 'data',
};

const MONTHLY_METRICS: StoreDefinition = {
  name: 'monthly_metrics',
  keyPath: 'anoMes',
};

const INSPECTION_SAMPLES: StoreDefinition = {
  name: 'inspection_samples',
  keyPath: 'id',
  indexes: [
    { name: 'kind', keyPath: 'kind' },
    { name: 'endpointType', keyPath: 'endpointType' },
    { name: 'timestamp', keyPath: 'timestamp' },
  ],
};

const CALIBRATION: StoreDefinition = {
  name: 'calibration',
  keyPath: 'id',
};

/** Janela de interação por lead (F3). */
const LEAD_WINDOWS: StoreDefinition = {
  name: 'lead_windows',
  keyPath: 'id',
  indexes: [
    { name: 'c2sLeadId', keyPath: 'c2sLeadId', unique: true },
    { name: 'estado', keyPath: 'estado' },
    { name: 'origem', keyPath: 'origem' },
    { name: 'prazoEm', keyPath: 'prazoEm' },
    { name: 'atualizadoEm', keyPath: 'atualizadoEm' },
  ],
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    stores: [LEADS, EVENT_LOGS, LEAD_ACTIONS, TEMPLATES, SETTINGS, DAILY_METRICS, MONTHLY_METRICS],
  },
  {
    version: 2,
    stores: [INSPECTION_SAMPLES],
  },
  {
    version: 3,
    stores: [CALIBRATION],
  },
  {
    version: 4,
    stores: [LEAD_WINDOWS],
  },
];

export const DB_NAME = 'c2s_local_bot';
export const DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 1;

export const STORE_NAMES = [
  'leads',
  'event_logs',
  'lead_actions',
  'templates',
  'settings',
  'daily_metrics',
  'monthly_metrics',
  'inspection_samples',
  'calibration',
  'lead_windows',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export interface SettingRow {
  chave: string;
  valor: unknown;
  atualizadoEm: string;
}

export interface InspectionSampleRow {
  id: string;
  kind: 'network' | 'dom' | 'selectors' | 'screenshot';
  endpointType?: string;
  timestamp: string;
  payload: unknown;
}

export interface CalibrationRow {
  id: 'current';
  counts: CalibrationCounts;
  confirmedAt?: string;
  appFingerprint?: string;
  atualizadoEm: string;
}
