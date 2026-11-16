import { describe, expect, it } from 'vitest';
import { clamp, parseJsonSafe, stableHash, truncate } from '@/shared/utils/validation';
import { addDays, addMonths, dayKey, parseC2sDateBr } from '@/shared/utils/dateUtils';

describe('validation', () => {
  it('trunca preservando o limite', () => {
    expect(truncate('abcdef', 3)).toEqual({ value: 'abc', truncated: true });
    expect(truncate('abc', 3)).toEqual({ value: 'abc', truncated: false });
  });

  it('limita valores', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('hash estável é determinístico e diferente por entrada', () => {
    expect(stableHash('lead-1')).toBe(stableHash('lead-1'));
    expect(stableHash('lead-1')).not.toBe(stableHash('lead-2'));
    expect(stableHash('lead-1')).toHaveLength(8);
  });

  it('parseJsonSafe não lança', () => {
    expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonSafe('{invalido')).toBeNull();
  });
});

describe('dateUtils', () => {
  it('lê data no formato do C2S', () => {
    const iso = parseC2sDateBr('13/11/2026 às 12:16:48');
    expect(iso).toBeDefined();
    expect(new Date(iso as string).getFullYear()).toBe(2026);
  });

  it('aceita data sem hora', () => {
    expect(parseC2sDateBr('01/02/2026')).toBeDefined();
    expect(parseC2sDateBr('sem data')).toBeUndefined();
  });

  it('soma dias e meses', () => {
    const base = new Date('2026-01-31T12:00:00.000Z');
    expect(addDays(base, 1).getUTCDate()).toBe(1);
    expect(addMonths(base, 1).getUTCMonth()).toBe(2);
  });

  it('chave do dia usa formato ISO local', () => {
    expect(dayKey(new Date(2026, 10, 13))).toBe('2026-11-13');
  });
});
