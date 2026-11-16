import { describe, expect, it } from 'vitest';
import { licenseService } from '@/background/license/licenseService';

describe('licenseService', () => {
  it('sem chave: NAO_CONFIGURADA', async () => {
    const state = await licenseService.validate({ licenseKey: '', offlineLicenseToleranceHours: 48 });
    expect(state.status).toBe('NAO_CONFIGURADA');
  });

  it('JSON fora do formato: INVALIDA', async () => {
    const state = await licenseService.validate({ licenseKey: '{"foo":1}', offlineLicenseToleranceHours: 48 });
    expect(state.status).toBe('INVALIDA');
    expect(state.motivo).toMatch(/Formato inválido/);
  });

  it('payload base64 sem JSON válido: INVALIDA', async () => {
    const state = await licenseService.validate({
      licenseKey: JSON.stringify({ payload: btoa('nao-e-json'), signature: btoa('x'.repeat(64)), alg: 'Ed25519' }),
      offlineLicenseToleranceHours: 48,
    });
    expect(state.status).toBe('INVALIDA');
  });

  it('payload com campos faltando: INVALIDA', async () => {
    const payload = btoa(JSON.stringify({ customer: 'x' }));
    const state = await licenseService.validate({
      licenseKey: JSON.stringify({ payload, signature: btoa('x'.repeat(64)), alg: 'Ed25519' }),
      offlineLicenseToleranceHours: 48,
    });
    expect(state.status).toBe('INVALIDA');
    expect(state.motivo).toMatch(/campos obrigatórios/);
  });
});
