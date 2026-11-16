import { CVRM_SELECTORS } from '../../shared/constants/cvcrm';
import { isValidLeadId } from '../../shared/analysis/cvcrmPolicy';
import type { CvKanbanLead } from '../../shared/types/cvcrm';

/**
 * Leitura do kanban do CV CRM.
 *
 * A etapa vem do link do cabeçalho da coluna (`?q[999|situacoes][]=N`), nunca
 * do título: o CRM trunca o texto da coluna nos cards ("Aguardando Atendimento
 * C...") e o rótulo de `Leads Vencidos` tem espaço à direita.
 */

const STAGE_FROM_HREF = /situacoes\]\[\]=(\d{1,3})/;

export function readKanban(doc: Document): CvKanbanLead[] {
  const leads: CvKanbanLead[] = [];
  const vistos = new Set<string>();

  for (const coluna of Array.from(doc.querySelectorAll(CVRM_SELECTORS.kanbanColuna))) {
    const etapa = stageFromColumn(coluna);
    if (etapa === null) continue;

    const cartoes = Array.from(coluna.querySelectorAll(CVRM_SELECTORS.kanbanCard));
    for (const cartao of cartoes) {
      const leadId = leadIdFromCard(cartao);
      if (!leadId || vistos.has(leadId)) continue;
      vistos.add(leadId);
      leads.push({
        leadId,
        etapa,
        diasNaSituacao: diasDoCartao(cartao, 'Na situa'),
        criadoDias: diasDoCartao(cartao, 'Criado'),
      });
    }
  }

  return leads;
}

function stageFromColumn(coluna: Element): number | null {
  const link = coluna.querySelector(CVRM_SELECTORS.kanbanHeadLink);
  const href = link?.getAttribute('href') ?? '';
  const encontrado = STAGE_FROM_HREF.exec(href);
  if (!encontrado?.[1]) return null;
  const etapa = Number.parseInt(encontrado[1], 10);
  return Number.isFinite(etapa) && etapa > 0 ? etapa : null;
}

function leadIdFromCard(cartao: Element): string | null {
  const link = cartao.querySelector(CVRM_SELECTORS.kanbanLeadLink);
  const doLink = link?.getAttribute('data-lead') ?? '';
  if (isValidLeadId(doLink)) return doLink;

  const titulo = cartao.querySelector(CVRM_SELECTORS.kanbanTitulo)?.textContent ?? '';
  const doTitulo = /#(\d{1,20})/.exec(titulo)?.[1] ?? '';
  return isValidLeadId(doTitulo) ? doTitulo : null;
}

function diasDoCartao(cartao: Element, rotulo: string): number | null {
  for (const item of Array.from(cartao.querySelectorAll(CVRM_SELECTORS.kanbanInfoItem))) {
    const titulo = (item.querySelector('p')?.textContent ?? '').trim();
    if (!titulo.startsWith(rotulo)) continue;
    const valor = (item.querySelector('h4 b')?.textContent ?? '').trim();
    const dias = Number.parseInt(valor, 10);
    return Number.isFinite(dias) ? dias : null;
  }
  return null;
}

/**
 * Ids de lead anunciados pelo próprio CRM em toast ("ID Lead: 91293").
 * É a detecção de custo zero: nenhuma requisição nossa, só leitura de DOM.
 */
export function readToastLeadIds(doc: Document): string[] {
  const container = doc.querySelector(CVRM_SELECTORS.toastContainer);
  if (!container) return [];

  const ids: string[] = [];
  for (const toast of Array.from(container.querySelectorAll('.toast, .toast-message, div'))) {
    const texto = toast.textContent ?? '';
    if (!texto.includes('ID Lead')) continue;
    // O id precisa terminar em fronteira: "ID Lead: 12abc" não é o lead 12.
    const encontrado = /ID Lead:\s*(\d{1,20})(?![0-9A-Za-z])/.exec(texto);
    if (encontrado?.[1] && isValidLeadId(encontrado[1])) ids.push(encontrado[1]);
  }
  return Array.from(new Set(ids));
}
