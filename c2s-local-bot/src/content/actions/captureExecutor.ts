import { SELECTOR_CONCEPTS } from '../../shared/constants/selectors';
import type { WindowActionResult } from '../../shared/types/window';
import { findBucketCard } from '../parsers/bucketParser';
import { isVisible, qs } from '../utils/domUtils';

/**
 * Executor da captura do Bolsão — click-first.
 *
 * Por que clicar em vez de chamar a API: o POST do C2S exige CSRF e é feito
 * pela própria página (`takeLeadToMe`). Reproduzir a chamada significaria
 * inventar headers e corpo. Clicando, a página executa o fluxo que já conhece.
 *
 * Garantias:
 *  - sem `eval`, sem `new Function`, sem fetch nosso;
 *  - nunca clica duas vezes no botão de confirmar (evita POST duplo);
 *  - se o modo inspeção ligar antes da confirmação, aborta sem POST;
 *  - se não houver confirmação observável, devolve `SEM_CONFIRMACAO` sem retry.
 */

const CARD_TIMEOUT_MS = 6_000;
const CONFIRM_TIMEOUT_MS = 12_000;
const POLL_MS = 150;

let executando = false;
let inspecaoAtiva = false;

/** Chamado pelo content script quando o modo inspeção muda. */
export function setCaptureSuspended(value: boolean): void {
  inspecaoAtiva = value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

function atrasoHumano(min: number, max: number): number {
  const lo = Math.max(0, Math.min(min, 60_000));
  const hi = Math.max(lo, Math.min(max, 60_000));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function visible(selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const element = qs(selector);
    if (element && isVisible(element)) return element;
  }
  return null;
}

function onLeadPage(c2sLeadId: string): boolean {
  try {
    const path = new URL(window.location.href).pathname;
    const match = path.match(/\/webapp\/leads\/(\d+)/);
    if (match?.[1] === c2sLeadId) return true;
  } catch {
    /* URL inválida: cai para o DOM */
  }
  const info = qs('#lead-info');
  return info?.getAttribute('data-id') === c2sLeadId;
}

type Outcome =
  | { kind: 'confirmar' }
  | { kind: 'negado' }
  | { kind: 'nao_interagido' }
  | { kind: 'free_tier' }
  | { kind: 'sucesso' };

function classify(c2sLeadId: string): Outcome | null {
  if (onLeadPage(c2sLeadId)) return { kind: 'sucesso' };
  if (visible(SELECTOR_CONCEPTS.bucketDeniedModal)) return { kind: 'negado' };
  if (visible(SELECTOR_CONCEPTS.bucketNotInteractedModal)) return { kind: 'nao_interagido' };
  if (
    visible(SELECTOR_CONCEPTS.bucketFreeTierModal) ||
    visible(SELECTOR_CONCEPTS.bucketLimitReached)
  ) {
    return { kind: 'free_tier' };
  }
  if (visible(SELECTOR_CONCEPTS.bucketClaimModal)) return { kind: 'confirmar' };
  return null;
}

function waitForOutcome(c2sLeadId: string, timeoutMs: number): Promise<Outcome | null> {
  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver | null = null;
    let timer = 0;
    let poll = 0;

    const done = (value: Outcome | null): void => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      window.clearTimeout(timer);
      window.clearInterval(poll);
      resolve(value);
    };

    const check = (): void => {
      const outcome = classify(c2sLeadId);
      if (outcome) done(outcome);
    };

    const root = document.documentElement;
    if (root) {
      observer = new MutationObserver(check);
      observer.observe(root, { childList: true, subtree: true, attributes: true });
    }
    poll = window.setInterval(check, POLL_MS);
    timer = window.setTimeout(() => done(classify(c2sLeadId)), timeoutMs);
    check();
  });
}

function click(element: Element): void {
  if (element instanceof HTMLElement) {
    element.click();
    return;
  }
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

export async function executeCapture(
  c2sLeadId: string,
  atrasoMinMs: number,
  atrasoMaxMs: number,
): Promise<WindowActionResult> {
  const iniciadoEm = Date.now();
  const result = (
    ok: boolean,
    motivo: string,
    etapa: WindowActionResult['etapa'],
    retentavel: boolean,
  ): WindowActionResult => ({
    ok,
    motivo,
    etapa,
    retentavel,
    duracaoMs: Date.now() - iniciadoEm,
    ...(onLeadPage(c2sLeadId) ? { urlFinal: window.location.href.slice(0, 2_048) } : {}),
  });

  if (executando) return result(false, 'EXECUCAO_CONCORRENTE', 'card', true);
  if (inspecaoAtiva) return result(false, 'INSPECAO_ATIVA', 'card', true);

  executando = true;
  try {
    const card = findBucketCard(c2sLeadId);
    if (!card) return result(false, 'CARD_AUSENTE', 'card', true);
    if (!isVisible(card)) return result(false, 'CARD_INVISIVEL', 'card', true);

    const handler = card.matches('[onclick*="openModalTakeLead"]')
      ? card
      : card.querySelector('[onclick*="openModalTakeLead"]');
    click(handler ?? card);

    // `confirmar` só é aceito depois de checar de novo o modo inspeção.
    const primeiro = await waitForOutcome(c2sLeadId, CARD_TIMEOUT_MS);
    if (!primeiro) return result(false, 'MODAL_NAO_ABRIU', 'modal', true);
    if (primeiro.kind === 'sucesso') return result(true, 'SUCESSO', 'confirmacao', false);
    if (primeiro.kind === 'negado') return result(false, 'LEAD_INDISPONIVEL', 'modal', false);
    if (primeiro.kind === 'nao_interagido') return result(false, 'NAO_INTERAGIDO', 'modal', false);
    if (primeiro.kind === 'free_tier') return result(false, 'FREE_TIER', 'modal', false);

    if (inspecaoAtiva) return result(false, 'INSPECAO_ATIVA', 'confirmacao', true);

    const confirmar = visible(SELECTOR_CONCEPTS.bucketClaimConfirmButton);
    if (!confirmar) return result(false, 'BOTAO_CONFIRMAR_AUSENTE', 'confirmacao', true);

    await sleep(atrasoHumano(atrasoMinMs, atrasoMaxMs));
    click(confirmar);

    // Daqui em diante não se clica de novo: um segundo clique seria outro POST.
    const segundo = await waitForOutcome(c2sLeadId, CONFIRM_TIMEOUT_MS);
    if (!segundo) return result(false, 'SEM_CONFIRMACAO', 'confirmacao', false);
    if (segundo.kind === 'sucesso') return result(true, 'SUCESSO', 'confirmacao', false);
    if (segundo.kind === 'negado') return result(false, 'LEAD_INDISPONIVEL', 'confirmacao', false);
    if (segundo.kind === 'nao_interagido') return result(false, 'NAO_INTERAGIDO', 'confirmacao', false);
    if (segundo.kind === 'free_tier') return result(false, 'FREE_TIER', 'confirmacao', false);

    // Modal ainda aberto depois do clique: o POST provavelmente não passou.
    return result(false, 'SEM_CONFIRMACAO', 'confirmacao', false);
  } finally {
    executando = false;
  }
}
