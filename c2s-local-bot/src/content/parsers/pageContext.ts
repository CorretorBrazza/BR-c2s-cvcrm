import type { PageContext } from '../../shared/types/inspection';
import { SELECTOR_CONCEPTS } from '../../shared/constants/selectors';
import { qs, safeQueryAll } from '../utils/domUtils';

export interface DetectedPage {
  context: PageContext;
  url: string;
  title: string;
  sessaoValida: boolean;
  evidencias: string[];
}

function anyMatch(selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    if (qs(selector)) return selector;
  }
  return undefined;
}

/**
 * Detecção por combinação de URL + DOM. URL sozinha não basta: o C2S usa
 * modais e views renderizadas no cliente.
 */
export function detectPageContext(url = window.location.href): DetectedPage {
  const evidencias: string[] = [];
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();

  const loginEvidence = anyMatch(SELECTOR_CONCEPTS.loginPage);
  const leadDetailEvidence = anyMatch(['#lead-info', '#lead-user-data', '#funnel-column-select']);
  const bucketEvidence = anyMatch(['.container.bucket-list', '.bucket-leads-title', '#free_tier_enabled']);
  const contactsEvidence = anyMatch([
    '.panel-body.lead-list',
    '#tab-today',
    '#new_filters',
    '[data-infinite-scroll-default]',
  ]);

  if (leadDetailEvidence) {
    evidencias.push(leadDetailEvidence);
    return { context: 'LEAD_DETAIL', url, title: document.title, sessaoValida: true, evidencias };
  }

  if (bucketEvidence || /\/webapp\/bucket_leads/i.test(path)) {
    if (bucketEvidence) evidencias.push(bucketEvidence);
    evidencias.push('url:/webapp/bucket_leads');
    return { context: 'BUCKET', url, title: document.title, sessaoValida: true, evidencias };
  }

  if (contactsEvidence || /\/webapp\/leads\/v2/i.test(path)) {
    if (contactsEvidence) evidencias.push(contactsEvidence);
    evidencias.push('url:/webapp/leads/v2');
    return { context: 'CONTACTS_LIST', url, title: document.title, sessaoValida: true, evidencias };
  }

  if (loginEvidence || /\/webapp\/login|\/login/i.test(path)) {
    if (loginEvidence) evidencias.push(loginEvidence);
    evidencias.push('url:/webapp/login');
    return { context: 'LOGIN', url, title: document.title, sessaoValida: false, evidencias };
  }

  if (/\/webapp\//i.test(path)) {
    const hasShell = safeQueryAll('#page-wrapper, .page-wrapper, #wrapper').length > 0;
    return {
      context: 'UNKNOWN',
      url,
      title: document.title,
      sessaoValida: hasShell,
      evidencias: hasShell ? ['shell:#page-wrapper'] : [],
    };
  }

  return { context: 'UNKNOWN', url, title: document.title, sessaoValida: false, evidencias };
}

export function isLeadDetailUrl(url = window.location.href): boolean {
  try {
    return /\/webapp\/leads\/\d+(?:\/hash\/|\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function isBucketUrl(url = window.location.href): boolean {
  try {
    return /\/webapp\/bucket_leads/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function extractLeadIdFromUrl(url = window.location.href): string | undefined {
  try {
    const match = new URL(url).pathname.match(/\/webapp\/leads\/(\d+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}
