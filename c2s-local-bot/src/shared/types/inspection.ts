export type PageContext = 'CONTACTS_LIST' | 'BUCKET' | 'LEAD_DETAIL' | 'LOGIN' | 'UNKNOWN';

export type EndpointType =
  | 'BUCKET_LEADS'
  | 'LEADS_V2'
  | 'LEAD_HASH'
  | 'LEAD_DETAIL'
  | 'STATUS_UPDATE'
  | 'FUNNEL_MOVE'
  | 'ACTIVITY_CREATE'
  | 'REPLY_SEND'
  | 'WHATSAPP_CLICK'
  | 'DESCONHECIDO';

export interface NetworkSample {
  id: string;
  correlationId: string;
  timestamp: string;
  url: string;
  method: string;
  status?: number;
  endpointType: EndpointType;
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string | null;
  responseBody?: string | null;
  responseContentType?: string | null;
  responseSize?: number;
  truncated?: boolean;
  /** Dados vindos do MAIN world são tratados como entrada não confiável. */
  untrusted: boolean;
  pageContext?: PageContext;
  tabId?: number;
  erro?: string;
}

/**
 * Evidência estrutural do script de captura da própria página.
 * Só fatos fixos (método, caminho, navegação) — nunca o script bruto nem PII.
 */
export interface CaptureScriptEvidence {
  metodoPost: boolean;
  metodoGetPreChecagem: boolean;
  /** Template, ex.: `/bucket_leads/{id}`. Vazio quando não reconhecido. */
  caminho: string;
  /** Navegação após sucesso, ex.: `/webapp/leads/{id}`. Vazio quando não reconhecida. */
  navegacaoSucesso: string;
  /** Sinal de não-captura (free tier), ex.: `redirect_to_upselling`. */
  sinalUpselling: string;
  /** A página expõe `<meta name="csrf-token">` (Rails). */
  csrfMetaPresente: boolean;
}

export interface DomSample {
  id: string;
  timestamp: string;
  context: PageContext;
  url: string;
  html: string;
  truncated: boolean;
  piiIncluded: boolean;
  tamanhoOriginal?: number;
  captureScript?: CaptureScriptEvidence;
}

export interface SelectorCandidate {
  concept: string;
  selector: string;
  score: number;
  matches: number;
  visiveis: number;
  nota?: string;
}

export interface SelectorProfile {
  id: string;
  timestamp: string;
  context: PageContext;
  url: string;
  candidates: SelectorCandidate[];
  faltando: string[];
}

export interface CalibrationCounts {
  bucketListResponse: number;
  leadsV2Response: number;
  captureGet: number;
  capturePost: number;
  leadDetailPage: number;
  contactsListPage: number;
  bucketPage: number;
  domSamples: number;
  selectorProfiles: number;
}

export interface CalibrationReadiness {
  counts: CalibrationCounts;
  minimos: CalibrationCounts;
  pronto: boolean;
  /** Bloqueiam a confirmação. */
  pendencias: string[];
  /** Não bloqueiam: só pedem confirmação na primeira captura real. */
  avisos: string[];
  confirmedAt: string;
  appFingerprint: string;
}

/* ------------------------------------------------------------------ */
/* Contrato inferido a partir das amostras                             */
/* ------------------------------------------------------------------ */

export type ContractConfidence = 'ALTA' | 'MEDIA' | 'BAIXA' | 'AUSENTE';

/** De onde o contrato foi derivado. Nunca inventamos: só o que a amostra prova. */
export type ContractOrigin = 'REDE' | 'DOM' | 'SCRIPT' | 'AUSENTE';

export interface ContractEvidence {
  amostras: number;
  primeiraEm?: string;
  ultimaEm?: string;
}

export interface BucketListContract {
  metodo: string;
  caminho: string;
  status?: number;
  formato: 'JSON' | 'HTML' | 'VAZIO' | 'DESCONHECIDO';
  chavesResposta: string[];
  caminhoItens?: string;
  chavesItem: string[];
  origem: ContractOrigin;
  /** Cards presentes no Bolsão ativo quando o contrato veio do DOM. */
  totalNoPool?: number;
  /** Classes observadas nos cards do pool (sem PII). */
  cardClasses?: string[];
  confianca: ContractConfidence;
  evidencia: ContractEvidence;
}

export interface CaptureContract {
  /** A captura aprovada no C2S é o POST; o GET é apenas a pré-checagem. */
  metodoAprovacao: 'POST';
  caminho: string;
  getObservado: boolean;
  postObservado: boolean;
  /** POST só é confirmado quando voltou 2xx. Sem isso, o contrato fica "a confirmar". */
  postConfirmado: boolean;
  origem: ContractOrigin;
  formatoPayload: 'FORM' | 'JSON' | 'VAZIO' | 'DESCONHECIDO';
  chavesPayload: string[];
  headersCsrf: string[];
  sinaisSucesso: string[];
  sinaisFalha: string[];
  statusObservados: number[];
  confianca: ContractConfidence;
  evidencia: ContractEvidence;
}

export interface InteractionGateContract {
  modalObservado: boolean;
  modalSelectors: string[];
  freeTierBloqueado: boolean;
  /** Valor lido de `#free_tier_enabled`: `true`, `false` ou `ausente`. */
  freeTierValor: 'true' | 'false' | 'ausente';
  amostrasDom: number;
  confianca: ContractConfidence;
}

export interface SelectorContractEntry {
  conceito: string;
  seletor: string;
  matches: number;
  visiveis: number;
  confianca: ContractConfidence;
}

export interface SelectorContract {
  entradas: SelectorContractEntry[];
  faltando: string[];
}

export interface CalibrationContract {
  geradoEm: string;
  totalAmostras: { rede: number; dom: number; seletores: number };
  bucketList: BucketListContract | null;
  capture: CaptureContract | null;
  gate: InteractionGateContract;
  seletores: SelectorContract;
  conflitos: string[];
  pendencias: string[];
}

export interface CalibrationBundle {
  bundleVersion: 1;
  exportedAt: string;
  extensionVersion: string;
  appFingerprint: string;
  counts: CalibrationCounts;
  network: NetworkSample[];
  dom: DomSample[];
  selectors: SelectorProfile[];
  /** Relatório derivado; nunca contém PII (apenas caminhos, chaves e sinais fixos). */
  contract?: CalibrationContract;
  notes?: string;
  piiIncluded: boolean;
}

export interface InspectionStatus {
  inspectMode: boolean;
  counts: CalibrationCounts;
  readiness: CalibrationReadiness;
  ultimaAmostraEm?: string;
  poucasAmostras: boolean;
}
