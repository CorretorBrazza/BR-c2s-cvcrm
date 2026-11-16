import {
  SELECTOR_CONCEPTS,
  SELECTOR_CONCEPT_LIST,
  type SelectorConcept,
} from '../../shared/constants/selectors';
import type {
  SelectorAuditReport,
  SelectorAuditRow,
  SelectorAuditSignals,
} from '../../shared/types/audit';
import { detectPageContext } from '../parsers/pageContext';
import { readC2sCountdownSeconds } from '../utils/timers';
import { isVisible, safeQueryAll } from '../utils/domUtils';
import { probeWindows } from './windowProbe';

/**
 * Assinatura do elemento sem texto: `div.bucket-lead-card.lead`.
 * Texto de card tem nome/telefone do lead e não pode ir para o diagnóstico.
 */
function signature(element: Element): string {
  const classes = Array.from(element.classList).slice(0, 3).join('.');
  const tag = element.tagName.toLowerCase();
  return classes ? `${tag}.${classes}` : tag;
}

/** Modais que importam para decidir se a captura está liberada agora. */
const MODAIS_DE_CAPTURA: SelectorConcept[] = [
  'bucketClaimModal',
  'bucketDeniedModal',
  'bucketNotInteractedModal',
  'bucketFreeTierModal',
  'bucketLimitReached',
];

function countConcept(conceito: SelectorConcept): { encontrados: number; visiveis: number } {
  let encontrados = 0;
  let visiveis = 0;
  for (const seletor of SELECTOR_CONCEPTS[conceito]) {
    const elementos = safeQueryAll(seletor);
    encontrados += elementos.length;
    visiveis += elementos.filter((element) => isVisible(element)).length;
  }
  return { encontrados, visiveis };
}

/**
 * Lê o que já foi lido pelo probe, sem duplicar regra.
 *
 * Só contagens e ids: o relatório é colado em chat de suporte, então nome,
 * telefone e mensagem ficam de fora por construção.
 */
function buildSignals(contexto: SelectorAuditReport['contexto']): SelectorAuditSignals {
  const probe = probeWindows();
  const cardsAtivos = countConcept('bucketLeadCard');
  const cardsHistorico = countConcept('bucketHistoryCard').encontrados;

  const modaisVisiveis = MODAIS_DE_CAPTURA.filter(
    (conceito) => countConcept(conceito).visiveis > 0,
  );

  const pool = probe.pool.map((item) => ({
    c2sLeadId: item.c2sLeadId,
    ...(item.segundosRestantes !== undefined
      ? { segundosRestantes: item.segundosRestantes }
      : {}),
    confianca: item.confianca,
  }));

  const contadorSegundos = readC2sCountdownSeconds(document);
  const semContador = pool.filter((item) => item.segundosRestantes === undefined).length;

  const diagnostico: string[] = [];

  if (contexto !== 'BUCKET') {
    diagnostico.push('A aba atual não é o Bolsão: os sinais de pool não se aplicam agora.');
  }
  if (probe.freeTier) {
    diagnostico.push('Conta em free tier: o próprio C2S bloqueia a captura.');
  }
  if (probe.bolsaoPausado) {
    diagnostico.push('Limite do Bolsão atingido no C2S: captura bloqueada pelo site.');
  }

  if (probe.bolsaoIndicado !== undefined) {
    if (probe.bolsaoIndicado > 0 && pool.length === 0) {
      diagnostico.push(
        `C2S indica ${probe.bolsaoIndicado} lead(s) no Bolsão, mas o parser leu 0 card(s): o seletor do card provavelmente mudou.`,
      );
    } else if (probe.bolsaoIndicado > 0) {
      diagnostico.push(
        `C2S indica ${probe.bolsaoIndicado} lead(s) no Bolsão e o parser leu ${pool.length} card(s).`,
      );
    } else {
      diagnostico.push('C2S indica Bolsão vazio: não haver card ativo é o esperado.');
    }
  } else if (contexto === 'BUCKET' && pool.length === 0) {
    diagnostico.push(
      'O C2S não publicou contagem no badge e não há card ativo: pool provavelmente vazio (ou o badge não renderizou).',
    );
  }

  if (cardsAtivos.encontrados === 0 && cardsHistorico > 0) {
    diagnostico.push(
      `Só há histórico (${cardsHistorico} card(s) .bucket-at-card): nada capturável nesta tela agora.`,
    );
  }
  if (cardsAtivos.encontrados === 0 && contexto === 'BUCKET') {
    diagnostico.push('Nenhum card ativo (.bucket-lead-card): o clique de captura não teria alvo.');
  } else if (cardsAtivos.encontrados > 0 && cardsAtivos.visiveis === 0) {
    diagnostico.push(
      `${cardsAtivos.encontrados} card(s) ativo(s) existem no DOM mas estão ocultos: o clique não teria alvo visível.`,
    );
  }
  if (pool.length > 0 && semContador > 0) {
    diagnostico.push(
      `${semContador} de ${pool.length} card(s) ativo(s) sem contador .bucket-time: nesses, o prazo cai na configuração.`,
    );
  }
  if (modaisVisiveis.length > 0) {
    diagnostico.push(`Modal(is) visível(is) agora: ${modaisVisiveis.join(', ')}.`);
  }

  return {
    ...(probe.bolsaoIndicado !== undefined ? { bolsaoIndicado: probe.bolsaoIndicado } : {}),
    freeTier: probe.freeTier,
    bolsaoPausado: probe.bolsaoPausado,
    cardsAtivos: cardsAtivos.encontrados,
    cardsHistorico,
    poolLido: pool.length,
    normalLido: probe.normal.length,
    poolDetalhe: pool,
    modaisVisiveis,
    ...(contadorSegundos !== undefined ? { contadorSegundos } : {}),
    diagnostico,
  };
}

/**
 * Testa cada conceito de seletor contra a página atual.
 * Síncrono e somente leitura: chamado pelo painel via mensagem.
 */
export function buildSelectorAudit(): SelectorAuditReport {
  const page = detectPageContext();
  const linhas: SelectorAuditRow[] = [];
  const conceitosSemMatch: string[] = [];

  for (const conceito of SELECTOR_CONCEPT_LIST) {
    const seletores = SELECTOR_CONCEPTS[conceito];
    let encontrados = 0;
    let visiveis = 0;
    let amostra: string | undefined;

    for (const seletor of seletores) {
      const elementos = safeQueryAll(seletor);
      encontrados += elementos.length;
      visiveis += elementos.filter((element) => isVisible(element)).length;
      if (!amostra && elementos[0]) amostra = signature(elementos[0]);
    }

    if (encontrados === 0) conceitosSemMatch.push(conceito);

    linhas.push({
      conceito,
      seletor: seletores.join(' | '),
      encontrados,
      visiveis,
      ...(amostra ? { amostra } : {}),
    });
  }

  return {
    geradoEm: new Date().toISOString(),
    url: page.url,
    contexto: page.context,
    linhas,
    conceitosComMatch: linhas.length - conceitosSemMatch.length,
    conceitosSemMatch,
    sinais: buildSignals(page.context),
  };
}
