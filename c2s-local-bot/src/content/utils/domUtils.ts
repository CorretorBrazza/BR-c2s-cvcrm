export function qs<T extends Element = Element>(selector: string, root: ParentNode = document): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

export function qsa<T extends Element = Element>(selector: string, root: ParentNode = document): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
}

/** querySelectorAll que nunca estoura com seletor inválido. */
export function safeQueryAll(selector: string, root: ParentNode = document): Element[] {
  return qsa(selector, root);
}

export function isVisible(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (element.hidden) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function textOf(element: Element | null, max = 500): string {
  if (!element) return '';
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function attr(element: Element | null, name: string, max = 2_000): string {
  if (!element) return '';
  return (element.getAttribute(name) ?? '').slice(0, max);
}

export function closestSafe(element: Element | null, selector: string): Element | null {
  if (!element) return null;
  try {
    return element.closest(selector);
  } catch {
    return null;
  }
}

/** Normaliza texto para comparação (sem acento, minúsculo). */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stripScriptsAndComments(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script data-removido="inspecao"></script>')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style data-removido="inspecao"></style>');
}

export function truncateText(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}
