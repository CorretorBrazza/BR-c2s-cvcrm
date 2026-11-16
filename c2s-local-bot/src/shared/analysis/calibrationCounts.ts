import type { CalibrationCounts, DomSample, NetworkSample, SelectorProfile } from '../types/inspection';

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}

/** `/webapp/bucket_leads` (lista) — nunca `/bucket_leads/{id}` (captura). */
export function isBucketListPath(path: string): boolean {
  return /^\/webapp\/bucket_leads$/i.test(path);
}

/** `/bucket_leads/{id}` — GET de pré-checagem e POST de captura. */
export function isBucketCapturePath(path: string): boolean {
  return /^\/bucket_leads\/\d+$/i.test(path);
}

export function isSuccessStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300;
}

export function hasResponseBody(sample: NetworkSample): boolean {
  return typeof sample.responseBody === 'string' && sample.responseBody.trim().length > 0;
}

/**
 * Contagem de evidência usada pela prontidão da calibração.
 *
 * Regra: só conta como "resposta" o que realmente voltou com corpo e status 2xx.
 * Uma captura (`/bucket_leads/{id}`) NUNCA conta como lista do Bolsão.
 */
export function computeCalibrationCounts(input: {
  network: NetworkSample[];
  dom: DomSample[];
  selectors: SelectorProfile[];
}): CalibrationCounts {
  const counts: CalibrationCounts = {
    bucketListResponse: 0,
    leadsV2Response: 0,
    captureGet: 0,
    capturePost: 0,
    leadDetailPage: 0,
    contactsListPage: 0,
    bucketPage: 0,
    domSamples: input.dom.length,
    selectorProfiles: input.selectors.length,
  };

  const contextCounts = { LEAD_DETAIL: 0, CONTACTS_LIST: 0, BUCKET: 0 };

  for (const sample of input.network) {
    const path = pathOf(sample.url);
    const responseOk = isSuccessStatus(sample.status) && hasResponseBody(sample);
    const capture = isBucketCapturePath(path);

    if (sample.endpointType === 'BUCKET_LEADS' && isBucketListPath(path) && responseOk) {
      counts.bucketListResponse++;
    }
    if (sample.endpointType === 'LEADS_V2' && responseOk) {
      counts.leadsV2Response++;
    }
    if (capture && sample.method.toUpperCase() === 'GET') counts.captureGet++;
    if (capture && sample.method.toUpperCase() === 'POST') counts.capturePost++;

    if (sample.endpointType === 'LEAD_DETAIL' || sample.endpointType === 'LEAD_HASH') {
      contextCounts.LEAD_DETAIL++;
    }
    if (sample.pageContext === 'LEAD_DETAIL') contextCounts.LEAD_DETAIL++;
    if (sample.pageContext === 'CONTACTS_LIST') contextCounts.CONTACTS_LIST++;
    if (sample.pageContext === 'BUCKET') contextCounts.BUCKET++;
  }

  // DOM também é evidência de visita: páginas de documento não passam por fetch/XHR.
  for (const sample of input.dom) {
    if (sample.context === 'LEAD_DETAIL') contextCounts.LEAD_DETAIL++;
    if (sample.context === 'CONTACTS_LIST') contextCounts.CONTACTS_LIST++;
    if (sample.context === 'BUCKET') contextCounts.BUCKET++;
  }

  counts.leadDetailPage = Math.min(contextCounts.LEAD_DETAIL, 99);
  counts.contactsListPage = Math.min(contextCounts.CONTACTS_LIST, 99);
  counts.bucketPage = Math.min(contextCounts.BUCKET, 99);

  return counts;
}
