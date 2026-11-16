import { SELECTOR_CONCEPTS, type SelectorConcept } from '../../shared/constants/selectors';
import type { SelectorCandidate, SelectorProfile } from '../../shared/types/inspection';
import { safeQueryAll, isVisible } from '../utils/domUtils';
import { detectPageContext } from '../parsers/pageContext';

/**
 * Perfila TODOS os seletores candidatos de cada conceito (não só o vencedor).
 * É o dado que permite calibrar o robô sem adivinhar seletores.
 */
export function buildSelectorProfile(): SelectorProfile {
  const page = detectPageContext();
  const candidates: SelectorCandidate[] = [];
  const faltando: string[] = [];

  for (const concept of Object.keys(SELECTOR_CONCEPTS) as SelectorConcept[]) {
    const selectors = SELECTOR_CONCEPTS[concept];
    let conceptTemMatch = false;

    for (const [index, selector] of selectors.entries()) {
      const elements = safeQueryAll(selector);
      const visiveis = elements.filter((element) => isVisible(element)).length;
      const matches = elements.length;
      if (matches > 0) conceptTemMatch = true;

      const score = matches === 0 ? 0 : matches * 10 + visiveis * 25 - index * 2;
      candidates.push({
        concept,
        selector,
        score,
        matches,
        visiveis,
        ...(matches === 0 ? { nota: 'sem correspondência' } : {}),
      });
    }

    if (!conceptTemMatch) faltando.push(concept);
  }

  return {
    id: `sel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    context: page.context,
    url: window.location.href,
    candidates,
    faltando,
  };
}
