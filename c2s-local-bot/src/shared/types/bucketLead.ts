export interface BucketLeadItem {
  c2sLeadId: string;
  nome?: string;
  telefone?: string;
  imovel?: string;
  criadoEm?: string;
  /** Prazo restante publicado pelo C2S (`.bucket-time .timer-count[data-seconds]`). */
  segundosRestantes?: number;
  disponivelEm?: string;
  removidoEm?: string;
  extraidoDe: 'NETWORK' | 'DOM';
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA';
  seletorUsado?: string;
  raw?: unknown;
}

export interface BucketSnapshot {
  capturadoEm: string;
  itens: BucketLeadItem[];
  totalDisponivel: number;
  freeTierLimitReached: boolean;
  paginaDetectada: boolean;
  extraidoDe: 'NETWORK' | 'DOM';
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA';
  observacoes?: string[];
}

export interface BucketCaptureResult {
  c2sLeadId: string;
  sucesso: boolean;
  motivo?: string;
  statusHttp?: number;
  redirecionouPara?: string;
  confirmadoEm?: string;
  duracaoMs?: number;
}
