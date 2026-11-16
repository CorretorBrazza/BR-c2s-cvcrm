import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { sanitizeSettings } from '@/background/storage/repositories/settingsRepository';
import { extractVariables } from '@/background/storage/repositories/templateRepository';
import { maskText } from '@/background/security/dataMasking';

describe('sanitizeSettings', () => {
  it('mantém automação desligada por padrão', () => {
    const settings = sanitizeSettings({});
    expect(settings.autoClaimPool).toBe(false);
    expect(settings.autoSendMessage).toBe(false);
    expect(settings.inspectMode).toBe(true);
    expect(settings.telemetryEnabled).toBe(false);
  });

  it('só aceita `true` literal para automação', () => {
    const settings = sanitizeSettings({ autoClaimPool: 'true' as unknown as boolean });
    expect(settings.autoClaimPool).toBe(false);
  });

  it('clampa números e ordena delays', () => {
    const settings = sanitizeSettings({ poolDelayMinMs: 9_000, poolDelayMaxMs: 1_000 });
    expect(settings.poolDelayMinMs).toBe(1_000);
    expect(settings.poolDelayMaxMs).toBe(9_000);

    const clamped = sanitizeSettings({ pollingIntervalMs: 1 });
    expect(clamped.pollingIntervalMs).toBeGreaterThanOrEqual(2_000);
  });

  it('descarta chaves desconhecidas', () => {
    const settings = sanitizeSettings({ hacker: 'sim' } as never);
    expect((settings as unknown as Record<string, unknown>).hacker).toBeUndefined();
    expect(settings.botActive).toBe(DEFAULT_SETTINGS.botActive);
  });

  it('sanitiza licenseKey e remove espaços', () => {
    const settings = sanitizeSettings({ licenseKey: '  abc  ' });
    expect(settings.licenseKey).toBe('abc');
  });
});

describe('extractVariables', () => {
  it('encontra apenas variáveis conhecidas', () => {
    expect(extractVariables('Olá {nome}, sobre {imovel} em {data}. {desconhecida}')).toEqual([
      'nome',
      'imovel',
      'data',
    ]);
  });
});

describe('dataMasking', () => {
  it('mascara telefone, e-mail, CPF e token', () => {
    const text =
      'Fone (11) 98765-4321 email joao@teste.com CPF 123.456.789-00 authenticity_token=abc123';
    const masked = maskText(text);
    expect(masked).not.toContain('98765');
    expect(masked).not.toContain('joao@');
    expect(masked).not.toContain('123.456.789-00');
    expect(masked).toContain('[REDACTED]');
  });
});
