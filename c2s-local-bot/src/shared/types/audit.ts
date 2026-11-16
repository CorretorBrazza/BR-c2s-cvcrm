import type { PageContext } from './inspection';
import type { Confidence } from './window';

/**
 * Auditoria de seletores.
 *
 * O risco real de um bot de DOM não é errar o clique: é continuar "funcionando"
 * depois que o site mudou de layout. Aqui cada conceito de seletor é testado
 * contra a página atual e o relatório diz o que deixou de casar.
 *
 * O relatório nunca inclui texto do lead — só contagem e a assinatura do
 * elemento (tag + classes), para não vazar PII no Diagnóstico.
 */
export interface SelectorAuditRow {
  conceito: string;
  seletor: string;
  encontrados: number;
  visiveis: number;
  /** Assinatura segura do primeiro elemento (tag + até 3 classes), sem texto. */
  amostra?: string;
}

/**
 * Sinais independentes dos seletores.
 *
 * A tabela de conceitos responde "o seletor casou?". Estes sinais respondem a
 * pergunta seguinte, que é a que importa: "o pool está vazio ou o seletor
 * quebrou?". Sem o badge do C2S (`#badged_bolsao`) os dois casos são
 * indistinguíveis no relatório.
 *
 * Nada aqui carrega nome, telefone ou mensagem: só contagem, id do C2S e prazo.
 */
export interface SelectorAuditSignals {
  /** Quantos leads o próprio C2S diz que há no Bolsão. `undefined` = não publicou. */
  bolsaoIndicado?: number;
  /** `#free_tier_enabled == "true"` ou caixa de upgrade visível. */
  freeTier: boolean;
  /** O C2S está bloqueando captura por limite do Bolsão. */
  bolsaoPausado: boolean;
  /** Cards ativos (capturáveis) encontrados no DOM. */
  cardsAtivos: number;
  /** Cards do histórico (`.bucket-at-card`) — nunca capturáveis. */
  cardsHistorico: number;
  /** Leads que o parser conseguiu ler no pool. */
  poolLido: number;
  /** Leads que o parser conseguiu ler na lista normal. */
  normalLido: number;
  /** Ids do pool com prazo publicado, sem nenhum dado do lead. */
  poolDetalhe: Array<{ c2sLeadId: string; segundosRestantes?: number; confianca: Confidence }>;
  /** Modais do Bolsão presentes E visíveis neste instante. */
  modaisVisiveis: string[];
  /** Valor atual do contador do C2S (`.bucket-time .timer-count`), se houver. */
  contadorSegundos?: number;
  /** Leitura humana dos sinais acima. Vazio = nada digno de nota. */
  diagnostico: string[];
}

export interface SelectorAuditReport {
  geradoEm: string;
  url: string;
  contexto: PageContext;
  linhas: SelectorAuditRow[];
  conceitosComMatch: number;
  conceitosSemMatch: string[];
  sinais: SelectorAuditSignals;
}
