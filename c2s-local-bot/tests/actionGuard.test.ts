import { describe, expect, it, vi } from 'vitest';

/**
 * O teste de "build desligado" não pode depender do `.env` local: aqui a flag
 * é fixada em `false`, como num build de produção sem automação.
 */
vi.mock('@/shared/constants/featureFlags', () => ({
  FEATURE_FLAGS: {
    automationEnabled: false,
    activityAutomationEnabled: false,
    inspectionEnabled: true,
    telemetryEnabled: false,
    screenshotsEnabled: true,
  },
  isAutomationUnlocked: () => false,
}));

import { evaluateAction, isInteractionEvidence, type GuardContext } from '@/content/actions/actionGuard';

const base: GuardContext = {
  automationEnabled: true,
  calibrationConfirmedAt: '2026-11-13T00:00:00.000Z',
  optInAt: '2026-11-13T00:00:00.000Z',
  inspectMode: false,
  botActive: true,
  paused: false,
  settings: {
    autoClaimPool: true,
    autoMoveToAttendance: true,
    autoCreateFollowUp: true,
    autoSendMessage: true,
  },
  license: {
    status: 'VALIDA',
    origem: 'OFFLINE',
    payload: {
      customer: 'Teste',
      plan: 'pro',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      licenseId: 'lic-1',
      features: {
        bucketCapture: true,
        autoStatus: true,
        autoActivity: true,
        autoMessage: true,
        metrics: true,
      },
    },
  },
};

describe('actionGuard', () => {
  it('bloqueia enquanto a flag de build estiver desligada', () => {
    const decision = evaluateAction({ type: 'CAPTURAR_BOLSAO', c2sLeadId: '1' }, base);
    expect(decision.allowed).toBe(false);
    expect(decision.motivo).toMatch(/Automação desativada/);
  });

  it('bloqueia operações proibidas sempre', () => {
    const decision = evaluateAction({ type: 'DELETE_LEAD' }, base);
    expect(decision.allowed).toBe(false);
    expect(decision.motivo).toMatch(/proibida/);
  });

  it('nunca trata WhatsApp como interação', () => {
    expect(isInteractionEvidence({ tipo: 'WHATSAPP_CLICK' })).toBe(false);
    expect(isInteractionEvidence({ tipo: 'REPLY_SENT' })).toBe(true);
    expect(isInteractionEvidence({ tipo: 'CUSTOMER_REPLY' })).toBe(true);
  });
});
