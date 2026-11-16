export interface DailyMetrics {
  /** YYYY-MM-DD (fuso local do corretor) */
  data: string;
  leadsDetectados: number;
  leadsBolsao: number;
  leadsDiretos: number;
  leadsCapturados: number;
  leadsPerdidos: number;
  leadsEmAtendimento: number;
  mensagensEnviadas: number;
  falhas: number;
  tempoMedioCapturaMs: number;
  taxaCaptura: number;
  atualizadoEm: string;
}

export interface MonthlyMetrics {
  /** YYYY-MM */
  anoMes: string;
  leadsDetectados: number;
  leadsBolsao: number;
  leadsDiretos: number;
  leadsCapturados: number;
  leadsPerdidos: number;
  leadsEmAtendimento: number;
  mensagensEnviadas: number;
  falhas: number;
  tempoMedioCapturaMs: number;
  taxaCaptura: number;
  melhorDia?: string;
  piorDiaPerdas?: string;
  atualizadoEm: string;
}

export interface MetricsSnapshot {
  hoje: DailyMetrics;
  mes: MonthlyMetrics;
  janela7Dias: DailyMetrics[];
  status: BotStatus;
  atualizadoEm: string;
}

export type BotStatus =
  | 'MONITORANDO'
  | 'CAPTURANDO'
  | 'ORGANIZANDO'
  | 'ENVIANDO'
  | 'AGUARDANDO'
  | 'PAUSADO'
  | 'ERRO'
  | 'SESSAO_EXPIRADA'
  | 'LIMITE_ATINGIDO'
  | 'LICENCA_EXPIRADA'
  | 'INSPECIONANDO';

export type StatusConexao = 'CONECTADO' | 'DESCONECTADO' | 'SESSAO_EXPIRADA' | 'ABA_FECHADA';
