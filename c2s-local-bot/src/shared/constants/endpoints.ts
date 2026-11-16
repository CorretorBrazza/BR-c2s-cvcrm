export const C2S_ORIGIN = 'https://api.contact2sale.com';
export const C2S_HOST = 'api.contact2sale.com';
export const C2S_MATCH_PATTERN = 'https://api.contact2sale.com/*';

export const C2S_PATHS = {
  login: '/webapp/login',
  bucketPage: '/webapp/bucket_leads',
  bucketLead: (leadId: string | number) => `/bucket_leads/${leadId}`,
  bucketUpsellFreeTier: '/bucket_leads/upselling_free_tier',
  bucketUpselling: '/upsellings/bucket_leads',
  leadsV2: '/webapp/leads/v2',
  leadsV2PendingBulkUpdate: '/webapp/leads/v2/pending_bulk_update',
  leadPage: (leadId: string | number) => `/webapp/leads/${leadId}`,
  leadDetail: (leadId: string | number, hash: string) => `/webapp/leads/${leadId}/hash/${hash}`,
  leadStatusUpdate: '/webapp/leads/status_update',
  leadSuperReply: '/webapp/leads/super_reply',
  leadActivity: (leadId: string | number) => `/webapp/leads/${leadId}/activity`,
  leadOfferUpdate: (leadId: string | number) => `/webapp/leads/offer_update/${leadId}`,
  leadMarkVisit: (leadId: string | number) => `/leads/mark-visit/${leadId}`,
  leadUpdateObs: '/leads/update_obs',
  funnelMove: (funnelId: string | number, leadId: string | number) =>
    `/kanban_funnels/${funnelId}/funnel_leads/${leadId}/move`,
  whatsappClick: (leadId: string | number) => `/webapp2/leads/register_whatsapp_click/${leadId}`,
  menuLoader: '/webapp/loader/menu',
} as const;

/** Padrões usados para classificar respostas capturadas. */
export const ENDPOINT_PATTERNS = {
  bucketLeads: /\/webapp\/bucket_leads(?:\?|$|\/)/i,
  bucketLeadApi: /\/bucket_leads\/\d+(?:\?|$)/i,
  leadsV2: /\/webapp\/leads\/v2(?:\?|$)/i,
  leadDetail: /\/webapp\/leads\/\d+(?:\/hash\/|\/?$|\?)/i,
  statusUpdate: /\/webapp\/leads\/status_update/i,
  funnelMove: /\/kanban_funnels\/\d+\/funnel_leads\/\d+\/move/i,
  activityCreate: /\/webapp\/leads\/\d+\/activity/i,
  replySend: /\/webapp\/leads\/super_reply/i,
  whatsappClick: /\/webapp2\/leads\/register_whatsapp_click\/\d+/i,
} as const;

export function isC2sUrl(url: string, base = C2S_ORIGIN): boolean {
  try {
    return new URL(url, base).host === C2S_HOST;
  } catch {
    return false;
  }
}

export function absoluteC2sUrl(path: string): string {
  return path.startsWith('http') ? path : `${C2S_ORIGIN}${path}`;
}
