export function nowIso(): string {
  return new Date().toISOString();
}

export function toDate(value: string | number | Date | undefined | null): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dayKey(value: string | number | Date = new Date(), timeZone?: string): string {
  const date = toDate(value) ?? new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
  return formatter.format(date);
}

export function monthKey(value: string | number | Date = new Date(), timeZone?: string): string {
  return dayKey(value, timeZone).slice(0, 7);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function diffMs(startIso: string, endIso: string): number | undefined {
  const start = toDate(startIso);
  const end = toDate(endIso);
  if (!start || !end) return undefined;
  return Math.max(0, end.getTime() - start.getTime());
}

export function formatDateTimeBr(value: string | number | Date | undefined | null): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes} min ${seconds}s`;
}

export function isRecent(iso: string | undefined, windowMs: number): boolean {
  const date = toDate(iso);
  if (!date) return false;
  return Date.now() - date.getTime() <= windowMs;
}

/** Converte "13/11/2026 às 12:16:48" (formato do C2S) para ISO. */
export function parseC2sDateBr(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const match = text
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:às|as)?\s*(\d{2}):(\d{2})(?::(\d{2}))?)?/i);
  if (!match) return undefined;
  const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = match;
  const date = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss),
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
