/**
 * Seletores observados nos dumps de calibração.
 * NUNCA use um único seletor em produção: sempre passe pelo selectorResolver.
 */
export const SELECTOR_CONCEPTS = {
  bucketPage: ['.container.bucket-list', '.bucket-leads-title'],
  /**
   * Card do Bolsão ATIVO (capturável). O id do lead vive no
   * `onclick="openModalTakeLead(<id>, ...)"`, não em href/data-id.
   */
  bucketLeadCard: [
    '.container.bucket-list > .leads .bucket-lead-card',
    '.bucket-lead-card',
    '.container.bucket-list > .leads [onclick*="openModalTakeLead"]',
  ],
  /**
   * Histórico "Últimos 10 leads que passaram pelo bolsão".
   * NUNCA é capturável — serve só para contexto/observação.
   */
  bucketHistoryCard: ['.container.bucket-list .bucket-at-card', '.ibox-bucket-at'],
  bucketClaimModal: ['#modal_bucket_lead', '.modal#modal_bucket_lead'],
  bucketClaimConfirmButton: [
    '#modal_bucket_lead .modal-footer .btn-primary',
    '#modal_bucket_lead button.btn-primary',
    '#modal_bucket_lead [onclick*="takeLeadToMe"]',
  ],
  bucketDeniedModal: ['#modal_bucket_lead_denied'],
  bucketNotInteractedModal: ['#modal_bucket_lead_not_interacted', '#modal-whatsapp-not-interaction'],
  bucketFreeTierModal: ['#modal_free_tier_enabled'],
  bucketLimitReached: ['.upgrade_bucket.free_tier_limit_reached'],

  contactsListPage: [
    '.panel-body.lead-list',
    '[data-infinite-scroll-default]',
    '#tab-today',
    '#tab-all',
    '#new_filters',
  ],
  contactsListRow: ['.lead-group a[href*="/webapp/leads/"]', '.ibox.ibox-lead', 'a[href*="/webapp/leads/"]'],

  leadDetailPage: ['#lead-info', '#lead-user-data', '#funnel-column-select', '#reply-options-area'],
  leadDetailRoot: ['#lead-info', '#lead-user-data', '.lead_details', '#page-wrapper'],
  leadFunnelSelect: ['#funnel-column-select', '.funnel-column-select-wrapper select'],
  leadReplyArea: ['#reply-area', 'textarea#reply-area', '.reply-area textarea'],
  leadReplyButton: ['#reply-options-area #reply', 'button#reply'],
  leadWhatsappButton: ['#open-conversation', 'a#open-conversation'],
  leadCustomerName: ['.customer-name strong', '#lead-user-data .customer-name', '#lead-info .customer-name'],
  leadMessages: ['.message-content', 'pre.message-content'],

  loginPage: ['form.login-form', 'input[name="username"]', 'form[action*="/webapp/login"]'],
  sessionMenu: ['#multi-user-dropdown', '#multi-user-menu', '#logout-button'],
} as const;

export type SelectorConcept = keyof typeof SELECTOR_CONCEPTS;

export const SELECTOR_CONCEPT_LIST = Object.keys(SELECTOR_CONCEPTS) as SelectorConcept[];

/** Conceitos que o bot usa para automação (F4+). */
export const AUTOMATION_CONCEPTS: SelectorConcept[] = [
  'bucketPage',
  'bucketLeadCard',
  'bucketClaimModal',
  'bucketClaimConfirmButton',
  'bucketDeniedModal',
  'bucketNotInteractedModal',
  'bucketFreeTierModal',
  'bucketLimitReached',
  'leadDetailPage',
  'leadFunnelSelect',
  'leadReplyArea',
  'leadReplyButton',
];
