/** Remove tudo que não é dígito. */
export function digitsOnly(value: string | undefined | null): string {
  return (value ?? '').replace(/\D+/g, '');
}

/**
 * Normaliza telefone brasileiro para o formato E.164 sem "+".
 * Regras:
 *  - 10 ou 11 dígitos => prefixa 55
 *  - 12 ou 13 dígitos começando com 55 => mantém
 *  - outros casos => devolve os dígitos (sem inventar)
 */
export function normalizePhone(value: string | undefined | null, defaultCountry = '55'): string {
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `${defaultCountry}${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits;
  return digits;
}

/** Mascara telefone preservando DDD e os 2 últimos dígitos. */
export function maskPhone(value: string | undefined | null): string {
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  const tail = digits.slice(-2);
  const ddd = digits.length >= 11 ? digits.slice(-11, -9) : digits.slice(0, 2);
  return `(${ddd}) *****-**${tail}`;
}

export function formatPhoneBr(value: string | undefined | null): string {
  const digits = digitsOnly(value);
  const local =
    digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return value ?? '';
}

export function isValidPhone(value: string | undefined | null): boolean {
  const digits = digitsOnly(value);
  return digits.length >= 10 && digits.length <= 13;
}

export function samePhone(a: string | undefined | null, b: string | undefined | null): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return Boolean(left) && left === right;
}
