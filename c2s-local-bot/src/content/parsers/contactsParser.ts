import { SELECTOR_CONCEPTS } from '../../shared/constants/selectors';
import type { WindowCandidate } from '../../shared/types/window';
import { parseC2sDateBr } from '../../shared/utils/dateUtils';
import { attr, qs, safeQueryAll, textOf } from '../utils/domUtils';
import { readC2sCountdownSeconds } from '../utils/timers';

const LEAD_HREF_RE = /\/webapp\/leads\/(\d+)/;
const MAX_LEADS = 200;

/**
 * Lista de contatos (leads normais).
 *
 * Só olhamos o painel ATIVO. As abas escondidas repetem os mesmos leads e
 * trazem seções que não são "lead novo" (visitas, futuros), então usá-las
 * geraria janela para lead errado. A ordem do DOM é preservada porque o C2S
 * ordena por atividade: quem aparece antes é mais recente.
 */
function activeRoots(): ParentNode[] {
  const panes = safeQueryAll('.tab-pane.active').filter((pane) => qs('.panel-body.lead-list', pane));
  if (panes.length > 0) return panes;

  const lists = safeQueryAll('.panel-body.lead-list');
  if (lists.length > 0) return lists;

  return [document];
}

function isInsideBucket(element: Element): boolean {
  return element.closest('.bucket-list, #modal_bucket_lead') !== null;
}

function readCreatedAt(row: Element): string | undefined {
  const time = qs('time, [datetime], .lead-time, .created-at', row);
  if (!time) return undefined;
  const raw = attr(time, 'datetime') || textOf(time, 60);
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return parseC2sDateBr(raw);
}

function nameOf(anchor: Element, row: Element): string | undefined {
  const explicit = qs('.customer-name, .lead-name, .lead-title', row);
  const text = textOf(explicit, 120) || textOf(anchor, 120);
  return text || undefined;
}

/**
 * Extrai os leads normais visíveis no painel de contatos.
 * Nunca inventa id: só entra quem tem `/webapp/leads/<id>` no href.
 */
export function parseContactsDom(): WindowCandidate[] {
  const vistos = new Set<string>();
  const candidatos: WindowCandidate[] = [];

  for (const root of activeRoots()) {
    for (const selector of SELECTOR_CONCEPTS.contactsListRow) {
      for (const element of safeQueryAll(selector, root)) {
        if (isInsideBucket(element)) continue;

        const anchor =
          element.tagName === 'A' && LEAD_HREF_RE.test(element.getAttribute('href') ?? '')
            ? element
            : qs('a[href*="/webapp/leads/"]', element);

        const href = anchor?.getAttribute('href') ?? '';
        const match = href.match(LEAD_HREF_RE);
        const c2sLeadId = match?.[1];
        if (!c2sLeadId || !/^\d+$/.test(c2sLeadId) || vistos.has(c2sLeadId)) continue;

        vistos.add(c2sLeadId);
        const row = element.closest('.ibox-lead, .lead-item, .ibox, li') ?? element;
        const nome = nameOf(anchor ?? element, row);
        const criadoEm = readCreatedAt(row);
        // Quando o C2S publica o contador na linha, ele manda no prazo.
        const segundosRestantes = readC2sCountdownSeconds(row);

        candidatos.push({
          c2sLeadId,
          origem: 'NORMAL',
          ...(nome ? { nome } : {}),
          ...(criadoEm ? { criadoEm } : {}),
          ...(segundosRestantes !== undefined ? { segundosRestantes } : {}),
          confianca: nome ? 'ALTA' : 'MEDIA',
        });

        if (candidatos.length >= MAX_LEADS) return candidatos;
      }
    }
  }

  return candidatos;
}

/** A lista de contatos renderizou? (vazia também conta como renderizada) */
export function isContactsListVisible(): boolean {
  return safeQueryAll('.panel-body.lead-list').length > 0;
}
