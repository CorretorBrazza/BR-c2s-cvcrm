import type { BucketLeadItem, BucketSnapshot } from '../../shared/types/bucketLead';
import { SELECTOR_CONCEPTS } from '../../shared/constants/selectors';
import { normalizePhone, isValidPhone } from '../../shared/utils/phoneUtils';
import { parseC2sDateBr } from '../../shared/utils/dateUtils';
import { attr, isVisible, qsa, safeQueryAll, textOf } from '../utils/domUtils';
import { readC2sCountdownSeconds } from '../utils/timers';
import { isBucketUrl } from './pageContext';

const LEAD_ID_RE = /\/webapp\/leads\/(\d+)/;
const ONCLICK_ID_RE = /openModalTakeLead\(\s*['"]?(\d{1,20})/;
const PHONE_RE = /(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}/;

/**
 * O Bolsão chama `openModalTakeLead(<id>, ...)` no `onclick` do card; o id do
 * lead não fica em href/data-id. Cobrimos as três formas sem inventar nada.
 */
export function extractLeadId(element: Element): string | undefined {
  const href = element.getAttribute('href') ?? '';
  const match = href.match(LEAD_ID_RE);
  if (match?.[1]) return match[1];

  const direct = element.getAttribute('data-lead-id') ?? element.getAttribute('data-id');
  if (direct) return direct;

  const own = element.getAttribute('onclick')?.match(ONCLICK_ID_RE)?.[1];
  if (own) return own;

  const handler = element.querySelector('[onclick*="openModalTakeLead"]');
  if (handler) {
    const nested = handler.getAttribute('onclick')?.match(ONCLICK_ID_RE)?.[1];
    if (nested) return nested;
  }

  const link = element.querySelector('a[href*="/webapp/leads/"]');
  if (link) {
    const nestedHref = link.getAttribute('href')?.match(LEAD_ID_RE)?.[1];
    if (nestedHref) return nestedHref;
  }

  return undefined;
}

function parseCard(element: Element): BucketLeadItem | null {
  const c2sLeadId = extractLeadId(element);
  if (!c2sLeadId || !/^\d+$/.test(c2sLeadId)) return null;

  const container = element.closest('.bucket-lead-card, .ibox-lead, li, .lead-item') ?? element;
  const text = textOf(container, 1_500);

  const nameElement =
    container.querySelector('.lead-name, .customer-name, strong') ?? null;
  const nome = textOf(nameElement, 120) || undefined;

  const phoneMatch = text.match(PHONE_RE);
  const telefone = phoneMatch && isValidPhone(phoneMatch[0]) ? normalizePhone(phoneMatch[0]) : undefined;

  const imovel = textOf(container.querySelector('.product-name, .imovel, .property'), 160) || undefined;

  const timeElement = container.querySelector('time, [datetime], .lead-time, .created-at');
  const timeText = timeElement
    ? attr(timeElement, 'datetime') || textOf(timeElement, 60)
    : '';
  const criadoEm = timeText ? parseC2sDateBr(timeText) : undefined;

  // Só o card ativo publica contador; o histórico não. Ler do container é
  // seguro porque `closest` já restringiu ao card do lead.
  const segundosRestantes = readC2sCountdownSeconds(container);

  const evidencias = [nome, telefone, imovel].filter(Boolean).length;

  return {
    c2sLeadId,
    ...(nome ? { nome } : {}),
    ...(telefone ? { telefone } : {}),
    ...(imovel ? { imovel } : {}),
    ...(criadoEm ? { criadoEm } : {}),
    ...(segundosRestantes !== undefined ? { segundosRestantes } : {}),
    extraidoDe: 'DOM',
    confianca: evidencias >= 2 ? 'ALTA' : evidencias === 1 ? 'MEDIA' : 'BAIXA',
    ...(container.className ? { seletorUsado: `.${String(container.className).split(/\s+/)[0]}` } : {}),
  };
}

export function parseBucketDom(): BucketSnapshot {
  const itens: BucketLeadItem[] = [];
  const vistos = new Set<string>();

  for (const selector of SELECTOR_CONCEPTS.bucketLeadCard) {
    for (const element of safeQueryAll(selector)) {
      const item = parseCard(element);
      if (!item || vistos.has(item.c2sLeadId)) continue;
      vistos.add(item.c2sLeadId);
      itens.push(item);
    }
    if (itens.length > 0) break;
  }

  // O gate real do C2S é o VALOR do input (`== "true"`), não a presença dele.
  const freeTierInput = document.querySelector<HTMLInputElement>('#free_tier_enabled');
  const upgradeBox = document.querySelector('.upgrade_bucket');
  const freeTier =
    freeTierInput?.value === 'true' || (upgradeBox !== null && isVisible(upgradeBox));

  const limiteElement = document.querySelector('.free_tier_limit_reached');
  const limite = limiteElement !== null && isVisible(limiteElement);

  return {
    capturadoEm: new Date().toISOString(),
    itens,
    totalDisponivel: itens.length,
    freeTierLimitReached: limite,
    paginaDetectada: isBucketUrl(),
    extraidoDe: 'DOM',
    confianca: itens.length > 0 ? 'MEDIA' : 'BAIXA',
    observacoes: freeTier
      ? ['Conta em modo free tier: captura limitada pelo C2S.', ...(limite ? ['Limite de capturas atingido.'] : [])]
      : [],
  };
}

/** Contagem de cards visíveis — usada pelo watchdog de inspeção. */
export function countBucketCards(): { total: number; visiveis: number } {
  const cards = qsa(SELECTOR_CONCEPTS.bucketLeadCard.join(', '));
  return { total: cards.length, visiveis: cards.filter((card) => isVisible(card)).length };
}

/**
 * Localiza o card de um lead específico no Bolsão ativo.
 * Nunca cai no histórico (`.bucket-at-card`): histórico não é capturável.
 */
export function findBucketCard(c2sLeadId: string): Element | null {
  for (const selector of SELECTOR_CONCEPTS.bucketLeadCard) {
    for (const element of safeQueryAll(selector)) {
      if (extractLeadId(element) === c2sLeadId) return element;
    }
  }
  return null;
}
