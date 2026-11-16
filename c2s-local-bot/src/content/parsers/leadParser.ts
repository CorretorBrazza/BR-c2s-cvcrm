import type { LeadDetailSnapshot } from '../../shared/types/lead';
import { SELECTOR_CONCEPTS } from '../../shared/constants/selectors';
import { parseJsonSafe } from '../../shared/utils/validation';
import { parseC2sDateBr } from '../../shared/utils/dateUtils';
import { normalizePhone, isValidPhone } from '../../shared/utils/phoneUtils';
import { isVisible, qs, qsa, textOf } from '../utils/domUtils';
import { extractLeadIdFromUrl, isLeadDetailUrl } from './pageContext';
import { parseLeadHashFromUrl } from './hashParser';

const PHONE_TEXT_RE = /(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]?\d{4}/;

function firstText(selectors: readonly string[]): { text: string; selector: string } {
  for (const selector of selectors) {
    const element = qs(selector);
    const text = textOf(element);
    if (text) return { text, selector };
  }
  return { text: '', selector: '' };
}

function firstPhone(root: ParentNode = document): { phone: string; selector: string } {
  const tel = qs<HTMLAnchorElement>('a[href^="tel:"], a[href*="wa.me"], a[href*="whatsapp"]', root);
  if (tel) {
    const raw = tel.getAttribute('href') ?? '';
    const digits = raw.replace(/\D+/g, '');
    if (isValidPhone(digits)) return { phone: normalizePhone(digits), selector: 'a[href^="tel:"]' };
  }

  const phoneAttr = qs('[data-phone], [data-telefone], [data-whatsapp]', root);
  if (phoneAttr) {
    for (const name of ['data-phone', 'data-telefone', 'data-whatsapp']) {
      const digits = (phoneAttr.getAttribute(name) ?? '').replace(/\D+/g, '');
      if (isValidPhone(digits)) return { phone: normalizePhone(digits), selector: `[${name}]` };
    }
  }

  for (const selector of ['.lead-phone', '.phone', '.telefone', '#lead-user-data .phone']) {
    const element = qs(selector, root);
    const text = textOf(element, 80);
    if (text && PHONE_TEXT_RE.test(text)) {
      return { phone: normalizePhone(text), selector };
    }
  }

  const infoText = textOf(qs('#lead-info'), 6_000);
  const match = infoText.match(PHONE_TEXT_RE);
  if (match) return { phone: normalizePhone(match[0]), selector: '#lead-info (texto)' };

  return { phone: '', selector: '' };
}

function readDataLead(): Record<string, unknown> | null {
  const element = qs('#lead-user-data');
  if (!element) return null;
  const raw = element.getAttribute('data-lead');
  if (!raw) return null;
  const parsed = parseJsonSafe<unknown>(raw);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

function readDataJson(attribute: string): Record<string, unknown> | null {
  const element = qs('#lead-user-data');
  if (!element) return null;
  const parsed = parseJsonSafe<unknown>(element.getAttribute(attribute) ?? '');
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

function readFunnelOptions(): Array<{ id: string; label: string; atual: boolean }> {
  const select = qs<HTMLSelectElement>(SELECTOR_CONCEPTS.leadFunnelSelect.join(', '));
  if (!select) return [];
  return Array.from(select.options)
    .filter((option) => Boolean(option.value))
    .map((option) => ({
      id: option.value,
      label: option.textContent?.trim() ?? '',
      atual: option.selected,
    }));
}

function readRecentMessages(): Array<{ autor?: string; texto: string; criadoEm?: string }> {
  return qsa(SELECTOR_CONCEPTS.leadMessages.join(', '))
    .slice(-10)
    .map((element) => {
      const container = element.closest('.message, .chat-message');
      const autor = container ? textOf(qs('.message-author, .author', container), 80) : '';
      return {
        ...(autor ? { autor } : {}),
        texto: textOf(element, 800),
      };
    })
    .filter((message) => message.texto.length > 0);
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

/**
 * Extrai o snapshot da página de detalhe. Estratégia em camadas:
 *  1. JSON `data-lead` (fonte mais confiável);
 *  2. seletores de nome/telefone;
 *  3. hash da URL (status/contexto).
 */
export function parseLeadDetail(): LeadDetailSnapshot | null {
  if (!isLeadDetailUrl()) return null;

  const dataLead = readDataLead();
  const hash = parseLeadHashFromUrl();
  const urlLeadId = extractLeadIdFromUrl();

  const c2sLeadId =
    str(dataLead?.id) ??
    str(dataLead?.lead_id) ??
    urlLeadId ??
    '';
  if (!c2sLeadId) return null;

  const name = firstText(SELECTOR_CONCEPTS.leadCustomerName);
  const phone = firstPhone();
  const product = readDataJson('data-product') ?? readDataJson('data-company');

  const nome =
    str(dataLead?.name) ??
    str(dataLead?.nome) ??
    str(dataLead?.customer_name) ??
    (name.text || undefined);

  const telefone =
    str(dataLead?.phone) ??
    str(dataLead?.telefone) ??
    str(dataLead?.cellphone) ??
    (phone.phone || undefined);

  const imovel =
    str(product?.name) ??
    str(product?.title) ??
    (firstText(['.product-name', '.property-name', '#lead-user-data .product']).text || undefined);

  const statusC2S =
    str(dataLead?.status) ?? (hash?.status !== undefined ? hash.status : null);

  const temWhatsapp = Boolean(qs('#open-conversation, a[href*="wa.me"], [data-whatsapp]'));
  const temReplyArea = Boolean(qs(SELECTOR_CONCEPTS.leadReplyArea.join(', ')));

  const funilOpcoes = readFunnelOptions();
  const colunaAtual = funilOpcoes.find((option) => option.atual);

  const confianca: LeadDetailSnapshot['confianca'] = dataLead
    ? 'ALTA'
    : nome && telefone
      ? 'MEDIA'
      : 'BAIXA';

  return {
    c2sLeadId,
    ...(str(dataLead?.uuid) ? { c2sUuid: str(dataLead?.uuid) } : {}),
    ...(nome ? { nome } : {}),
    ...(telefone ? { telefone } : {}),
    ...(imovel ? { imovel } : {}),
    ...(statusC2S !== null && statusC2S !== undefined ? { statusC2S } : { statusC2S: null }),
    ...(str(dataLead?.created_at) ? { criadoEm: str(dataLead?.created_at) } : {}),
    ...(str(dataLead?.updated_at) || hash?.updated_at
      ? { atualizadoEm: str(dataLead?.updated_at) ?? hash?.updated_at }
      : {}),
    ...(colunaAtual ? { colunaAtualId: colunaAtual.id } : {}),
    ...(funilOpcoes.length > 0 ? { funilOpcoes } : {}),
    ...(str(dataLead?.seller_id) ? { responsavelId: str(dataLead?.seller_id) } : {}),
    ...(typeof dataLead?.interacted === 'boolean' ? { interacted: dataLead.interacted } : {}),
    temWhatsapp,
    temReplyArea,
    ...(readRecentMessages().length > 0 ? { mensagensRecentes: readRecentMessages() } : {}),
    extraidoEm: new Date().toISOString(),
    confianca,
    ...(dataLead ? { seletorUsado: '#lead-user-data[data-lead]' } : name.selector ? { seletorUsado: name.selector } : {}),
    raw: dataLead ?? undefined,
  };
}

/** Status do lead visível na lista (classes observadas no dump). */
export function readLeadListStatus(anchor: Element): string | null {
  const container = anchor.closest('.ibox, .lead-group, .lead-item') ?? anchor.parentElement;
  if (!container) return null;
  const badge = qs('.label, .badge, .status, [class*="status-"]', container);
  if (!badge) return null;
  const text = textOf(badge, 80);
  return text || null;
}

export function isReplyAreaVisible(): boolean {
  return isVisible(qs(SELECTOR_CONCEPTS.leadReplyArea.join(', ')));
}

/** Datas exibidas no C2S vêm em pt-BR; normaliza quando possível. */
export function normalizeC2sDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  return parseC2sDateBr(value);
}
