import { describe, expect, it } from 'vitest';
import {
  digitsOnly,
  formatPhoneBr,
  isValidPhone,
  maskPhone,
  normalizePhone,
  samePhone,
} from '@/shared/utils/phoneUtils';

describe('phoneUtils', () => {
  it('normaliza telefone de 11 dígitos para E.164 sem +', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321');
  });

  it('mantém telefone que já tem DDI', () => {
    expect(normalizePhone('5511987654321')).toBe('5511987654321');
    expect(normalizePhone('+55 11 98765-4321')).toBe('5511987654321');
  });

  it('não inventa dígitos em entradas curtas', () => {
    expect(normalizePhone('1234')).toBe('1234');
    expect(normalizePhone('')).toBe('');
  });

  it('mascara preservando DDD e final', () => {
    expect(maskPhone('11987654321')).toBe('(11) *****-**21');
  });

  it('formata para exibição pt-BR', () => {
    expect(formatPhoneBr('5511987654321')).toBe('(11) 98765-4321');
    expect(formatPhoneBr('1133334444')).toBe('(11) 3333-4444');
  });

  it('valida faixa de dígitos', () => {
    expect(isValidPhone('11987654321')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
  });

  it('compara telefones ignorando formatação', () => {
    expect(samePhone('(11) 98765-4321', '5511987654321')).toBe(true);
    expect(samePhone('(11) 98765-4321', '(11) 91234-5678')).toBe(false);
  });

  it('remove não-dígitos', () => {
    expect(digitsOnly('+55 (11) 9.8765-4321')).toBe('5511987654321');
  });
});
