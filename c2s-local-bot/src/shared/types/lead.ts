export type LeadStatusLocal =
  | 'NOVO'
  | 'CAPTURANDO'
  | 'CAPTURADO'
  | 'PERDIDO'
  | 'EM_ATENDIMENTO'
  | 'AGUARDANDO_RESPOSTA'
  | 'MENSAGEM_ENVIADA'
  | 'MENSAGEM_FALHOU'
  | 'ERRO'
  | 'CANCELADO';

export type LeadResultado = 'CAPTURADO' | 'PERDIDO' | 'PROTEGIDO' | 'PENDENTE';

export type LeadOrigemTipo = 'BOLSAO' | 'DIRETO' | 'DESCONHECIDA';

/** Registro local do lead. Chave primária de negócio: c2sLeadId. */
export interface LeadRecord {
  id: string;
  c2sLeadId: string;
  c2sUuid?: string;
  nome?: string;
  telefone?: string;
  telefoneMasked?: string;
  email?: string;
  emailMasked?: string;
  imovel?: string;
  origem?: string;
  origemDetalhe?: string;
  origemTipo: LeadOrigemTipo;
  detectadoEm: string;
  capturadoEm?: string;
  atualizadoEm: string;
  statusLocal: LeadStatusLocal;
  statusC2S?: string | null;
  funilId?: string;
  colunaId?: string;
  responsavelId?: string;
  resultado: LeadResultado;
  tempoCapturaMs?: number;
  tentativas: number;
  ultimoErro?: string;
  bucketAvailableAt?: string;
  interactedAt?: string;
  protegidoEm?: string;
  mensagemEnviadaEm?: string;
  raw?: unknown;
}

/** Snapshot extraído da página de detalhe (lead/hash). */
export interface LeadDetailSnapshot {
  c2sLeadId: string;
  c2sUuid?: string;
  nome?: string;
  telefone?: string;
  email?: string;
  imovel?: string;
  origem?: string;
  origemDetalhe?: string;
  statusC2S?: string | null;
  criadoEm?: string;
  atualizadoEm?: string;
  funilId?: string;
  colunaAtualId?: string;
  funilOpcoes?: Array<{ id: string; label: string; atual: boolean }>;
  responsavelId?: string;
  interacted?: boolean;
  temWhatsapp?: boolean;
  temReplyArea?: boolean;
  mensagensRecentes?: Array<{ autor?: string; texto: string; criadoEm?: string }>;
  extraidoEm: string;
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA';
  seletorUsado?: string;
  raw?: unknown;
}

/** Payload decodificado do "hash" da URL do lead (base64 de JSON). */
export interface LeadHashPayload {
  status?: string | null;
  company_id?: number;
  seller_id?: number;
  updated_at?: string;
  [key: string]: unknown;
}
