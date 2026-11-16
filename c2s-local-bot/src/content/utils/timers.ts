import { qs } from './domUtils';

/**
 * Contador de prazo que o próprio C2S publica no DOM.
 *
 * A lista de leads renderiza `.bucket-time > .timer-count` com o atributo
 * `data-seconds` e decrementa 1 por segundo via jQuery. Isso é a fonte de
 * verdade do prazo — melhor que estimar pela configuração do corretor.
 *
 * Só lemos o número: nenhum texto do lead é usado.
 */
const TIMER_SELECTOR = '.bucket-time .timer-count, .timer-count[data-seconds]';

export function readC2sCountdownSeconds(root: ParentNode): number | undefined {
  const timer = qs(TIMER_SELECTOR, root);
  const raw = timer?.getAttribute('data-seconds');
  if (!raw) return undefined;
  const segundos = Number(raw);
  if (!Number.isFinite(segundos) || segundos <= 0) return undefined;
  return Math.round(segundos);
}
