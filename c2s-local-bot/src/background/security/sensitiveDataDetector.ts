export interface PiiFinding {
  tipo: 'TELEFONE' | 'EMAIL' | 'CPF' | 'TOKEN';
  quantidade: number;
}

const PATTERNS: Array<{ tipo: PiiFinding['tipo']; regex: RegExp }> = [
  { tipo: 'EMAIL', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { tipo: 'TELEFONE', regex: /(?:\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}/g },
  { tipo: 'CPF', regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g },
  {
    tipo: 'TOKEN',
    regex: /(?:authenticity_token|csrf[-_]?token|authorization|cookie)["']?\s*[:=]\s*["']?[^"'&\s,}]+/gi,
  },
];

export function detectPii(text: string): PiiFinding[] {
  if (!text) return [];
  const findings: PiiFinding[] = [];
  for (const { tipo, regex } of PATTERNS) {
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      findings.push({ tipo, quantidade: matches.length });
    }
  }
  return findings;
}

export function containsSensitiveData(text: string): boolean {
  return detectPii(text).length > 0;
}

/** Heurística para avisar o corretor antes de exportar um bundle com PII. */
export function needsPiiWarning(text: string, minMatches = 3): boolean {
  return detectPii(text).reduce((total, finding) => total + finding.quantidade, 0) >= minMatches;
}
