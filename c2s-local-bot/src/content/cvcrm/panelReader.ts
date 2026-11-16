import { CVRM_HANDLERS, CVRM_SELECTORS } from '../../shared/constants/cvcrm';
import { cvUrlInfo, isValidLeadId } from '../../shared/analysis/cvcrmPolicy';
import type { CvPanelItem, CvPanelReading } from '../../shared/types/cvcrm';

/**
 * Leitura do painel de etapas (`.situacoes-workflow`) da página do lead.
 *
 * É somente leitura e não confia em rótulo: a etapa é o `id` numérico do
 * `<span class="status">`. Um item só conta como acionável quando o `<a>` pai
 * executa `modificarSituacao('<id>', ...)` — o handler do "Descartado"
 * (`chamaFacebox`) nunca é aceito.
 */

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;

export function readPanel(doc: Document, url: string): CvPanelReading {
  const info = cvUrlInfo(url);
  const workflows = doc.querySelectorAll(CVRM_SELECTORS.workflow);
  const primeiro = workflows[0] ?? null;
  const etapas = primeiro ? readStages(primeiro) : [];
  const ativo = etapas.find((etapa) => etapa.ativo);

  return {
    leadId: info.leadId ?? leadIdFromScripts(doc) ?? '',
    atual: ativo ? ativo.id : null,
    etapas,
    workflows: workflows.length,
    temForm: doc.querySelector(CVRM_SELECTORS.formSituacao) !== null,
  };
}

function readStages(root: Element): CvPanelItem[] {
  const vistos = new Map<number, CvPanelItem>();

  for (const span of Array.from(root.querySelectorAll(CVRM_SELECTORS.stage))) {
    const id = Number.parseInt(span.id, 10);
    if (!Number.isFinite(id) || id <= 0) continue;

    const ancora = span.closest('a');
    const onclick = ancora?.getAttribute('onclick') ?? '';
    const modificar = CVRM_HANDLERS.modificar.exec(onclick);
    const acionavel =
      modificar !== null &&
      Number.parseInt(modificar[1] ?? '', 10) === id &&
      !CVRM_HANDLERS.facebox.test(onclick);

    const item: CvPanelItem = {
      id,
      label: (span.textContent ?? '').trim(),
      ativo: span.classList.contains('ativo'),
      acionavel,
    };

    const anterior = vistos.get(id);
    // Prefere a versão acionável/ativa caso o CRM renderize o mesmo id 2x.
    if (!anterior || (!anterior.acionavel && acionavel) || (!anterior.ativo && item.ativo)) {
      vistos.set(id, item);
    }
  }

  return Array.from(vistos.values());
}

/**
 * O `<a>` que executa a mudança para a etapa pedida. `null` = não existe
 * caminho válido; o executor nunca improvisa.
 */
export function findAnchor(doc: Document, stageId: number): HTMLAnchorElement | null {
  for (const span of Array.from(doc.querySelectorAll(CVRM_SELECTORS.stage))) {
    if (Number.parseInt(span.id, 10) !== stageId) continue;
    const ancora = span.closest('a');
    if (!(ancora instanceof HTMLAnchorElement)) continue;
    const onclick = ancora.getAttribute('onclick') ?? '';
    const modificar = CVRM_HANDLERS.modificar.exec(onclick);
    if (!modificar) continue;
    if (Number.parseInt(modificar[1] ?? '', 10) !== stageId) continue;
    if (CVRM_HANDLERS.facebox.test(onclick)) continue;
    return ancora;
  }
  return null;
}

/**
 * Fallback de identificação: páginas antigas trazem `var de = "<id>"` no
 * script inline do `modificarSituacao`. Lê no máximo 2 MB de scripts.
 */
function leadIdFromScripts(doc: Document): string | undefined {
  let lido = 0;
  for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const texto = script.textContent ?? '';
    lido += texto.length;
    if (lido > MAX_SCRIPT_BYTES) break;
    const encontrado = /var\s+de\s*=\s*"(\d{1,20})"/.exec(texto);
    if (encontrado?.[1] && isValidLeadId(encontrado[1])) return encontrado[1];
  }
  return undefined;
}
