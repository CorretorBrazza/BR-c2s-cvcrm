import { digitsOnly } from '../../shared/utils/phoneUtils';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const TOKEN_RE =
  /((?:authenticity_token|csrf[-_]?token|authorization|cookie|password|senha)["']?\s*[:=]\s*["']?)([^"'&\s,}]+)/gi;

const SENSITIVE_KEYS = [
  'telefone',
  'phone',
  'celular',
  'whatsapp',
  'email',
  'e-mail',
  'senha',
  'password',
  'token',
  'authenticity_token',
  'csrf',
  'cookie',
  'authorization',
  'cpf',
  'documento',
];

export function maskEmail(value: string): string {
  const [user, domain] = value.split('@');
  if (!user || !domain) return '***';
  const visible = user.slice(0, 1);
  return `${visible}***@${domain}`;
}

export function maskPhoneValue(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length < 4) return '****';
  return `*****${digits.slice(-4)}`;
}

export function maskText(text: string): string {
  return text
    .replace(EMAIL_RE, (match) => maskEmail(match))
    .replace(TOKEN_RE, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(CPF_RE, '***.***.***-**')
    .replace(PHONE_RE, (match) => (digitsOnly(match).length >= 10 ? maskPhoneValue(match) : match));
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate));
}

/** Mascara recursivamente strings e chaves sensíveis. */
export function maskDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return '[limite]' as unknown as T;
  if (typeof value === 'string') return maskText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? maskScalar(item) : maskDeep(item, depth + 1);
    }
    return output as unknown as T;
  }
  return value;
}

function maskScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.includes('@')) return maskEmail(value);
    return maskPhoneValue(value);
  }
  if (typeof value === 'number') return '***';
  return value === undefined || value === null ? value : '***';
}

export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveKey(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    // hash do lead é base64 de contexto — não é segredo, mas não precisa ir para log resumido
    parsed.pathname = parsed.pathname.replace(/\/hash\/[^/]+/, '/hash/[hash]');
    return parsed.toString();
  } catch {
    return maskText(url);
  }
}
