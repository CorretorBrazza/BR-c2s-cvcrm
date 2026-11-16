import { SELECTOR_CONCEPTS, type SelectorConcept } from '../../shared/constants/selectors';
import { safeQueryAll, isVisible } from '../utils/domUtils';

export interface ResolvedSelector {
  concept: SelectorConcept;
  selector: string;
  element: Element | null;
  matches: number;
  visiveis: number;
  score: number;
}

/**
 * Resolve um conceito testando todos os seletores candidatos.
 * Nunca assume que o primeiro seletor existe — o C2S muda de layout.
 */
export function resolveConcept(concept: SelectorConcept, root: ParentNode = document): ResolvedSelector {
  const candidates = SELECTOR_CONCEPTS[concept];
  let best: ResolvedSelector = {
    concept,
    selector: candidates[0] ?? '',
    element: null,
    matches: 0,
    visiveis: 0,
    score: 0,
  };

  for (const [index, selector] of candidates.entries()) {
    const elements = safeQueryAll(selector, root);
    if (elements.length === 0) continue;

    const visiveis = elements.filter((element) => isVisible(element)).length;
    // Prefere o seletor mais específico (primeiro da lista) quando há empate.
    const score = elements.length * 10 + visiveis * 25 - index * 2;
    if (score > best.score) {
      best = {
        concept,
        selector,
        element: elements[0] ?? null,
        matches: elements.length,
        visiveis,
        score,
      };
    }
  }

  return best;
}

export function resolveAll(root: ParentNode = document): Record<string, ResolvedSelector> {
  const output: Record<string, ResolvedSelector> = {};
  for (const concept of Object.keys(SELECTOR_CONCEPTS) as SelectorConcept[]) {
    output[concept] = resolveConcept(concept, root);
  }
  return output;
}

export function conceptAvailable(concept: SelectorConcept): boolean {
  return resolveConcept(concept).matches > 0;
}
