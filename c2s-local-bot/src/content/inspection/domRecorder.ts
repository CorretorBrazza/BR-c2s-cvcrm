import { LIMITS } from '../../shared/constants/limits';
import type { CaptureScriptEvidence, DomSample } from '../../shared/types/inspection';
import { stripScriptsAndComments, truncateText } from '../utils/domUtils';
import { detectPageContext } from '../parsers/pageContext';
import { sendToBackground } from '../utils/bridge';

const CAPTURE_FN = 'function takeLeadToMe';
const PRECHECK_FN = 'function openModalTakeLead';
const SCRIPT_WINDOW = 2_500;

function sliceFrom(text: string, marker: string, max = SCRIPT_WINDOW): string {
  const index = text.indexOf(marker);
  if (index < 0) return '';
  return text.slice(index, index + max);
}

/**
 * Deriva o contrato de captura do script inline da própria página.
 *
 * Só saem fatos fixos (método, caminho, navegação). O script bruto nunca é
 * persistido e nenhum texto livre é copiado — evita PII e evita "inventar"
 * endpoint a partir de conteúdo dinâmico.
 */
export function extractCaptureScript(): CaptureScriptEvidence | undefined {
  const inline = Array.from(document.querySelectorAll('script:not([src])'))
    .map((script) => script.textContent ?? '')
    .filter((text) => text.includes(CAPTURE_FN));

  if (inline.length === 0) return undefined;

  const source = inline[0] ?? '';
  const captureBlock = sliceFrom(source, CAPTURE_FN);
  const precheckBlock = sliceFrom(source, PRECHECK_FN);

  return {
    metodoPost: /type\s*:\s*["']POST["']/i.test(captureBlock),
    metodoGetPreChecagem: /type\s*:\s*["']GET["']/i.test(precheckBlock),
    caminho: /url\s*:\s*["']\/bucket_leads\/["']\s*\+\s*lead_id/.test(captureBlock)
      ? '/bucket_leads/{id}'
      : '',
    navegacaoSucesso: /window\.location\.href\s*=\s*["']\/webapp\/leads\/["']\s*\+\s*lead_id/.test(captureBlock)
      ? '/webapp/leads/{id}'
      : '',
    sinalUpselling: /redirect_to_upselling/.test(captureBlock) ? 'redirect_to_upselling' : '',
    csrfMetaPresente: document.querySelector('meta[name="csrf-token"]') !== null,
  };
}

/**
 * Captura um retrato do DOM atual. Scripts e comentários são removidos antes
 * de sair do content script; PII é mascarada no service worker.
 */
export function captureDomSample(): DomSample {
  const page = detectPageContext();
  const html = stripScriptsAndComments(document.documentElement.outerHTML);
  const result = truncateText(html, LIMITS.maxDomBytes);
  const captureScript = extractCaptureScript();

  return {
    id: `dom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    context: page.context,
    url: window.location.href,
    html: result.text,
    truncated: result.truncated,
    piiIncluded: false,
    tamanhoOriginal: html.length,
    ...(captureScript ? { captureScript } : {}),
  };
}

export function sendDomSample(): DomSample {
  const sample = captureDomSample();
  sendToBackground({ kind: 'insp:dom', id: 'content', payload: sample });
  return sample;
}
