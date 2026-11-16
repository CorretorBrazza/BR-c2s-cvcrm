import { describe, expect, it } from 'vitest';
import {
  WINDOW_LIMITS,
  backoffFor,
  deadlineFor,
  deadlineWithTimer,
  isActionable,
  isExpired,
  isTerminal,
  needsAttention,
  poolPaused,
  selectNext,
  shouldCreateWindow,
  statsOf,
  windowHealth,
  windowMinutesFor,
} from '@/shared/analysis/windowPolicy';
import type { LeadWindow } from '@/shared/types/window';

const NOW = new Date('2026-11-13T12:00:00.000Z').getTime();
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

function makeWindow(overrides: Partial<LeadWindow> = {}): LeadWindow {
  return {
    id: `w_${Math.random().toString(36).slice(2, 10)}`,
    c2sLeadId: '123',
    origem: 'POOL',
    acao: 'CAPTURAR_BOLSAO',
    estado: 'DETECTADO',
    detectadoEm: iso(-60_000),
    prazoEm: iso(120_000),
    tentativas: 0,
    confianca: 'ALTA',
    atualizadoEm: iso(-60_000),
    ...overrides,
  };
}

describe('windowPolicy: prazos', () => {
  it('limita a janela do pool e do lead normal', () => {
    expect(windowMinutesFor('POOL', { poolMinutes: 0, leadMinutes: 30 })).toBe(WINDOW_LIMITS.poolMinMinutes);
    expect(windowMinutesFor('POOL', { poolMinutes: 999, leadMinutes: 30 })).toBe(WINDOW_LIMITS.poolMaxMinutes);
    expect(windowMinutesFor('NORMAL', { poolMinutes: 3, leadMinutes: 1 })).toBe(WINDOW_LIMITS.leadMinMinutes);
    expect(windowMinutesFor('NORMAL', { poolMinutes: 3, leadMinutes: 99_999 })).toBe(WINDOW_LIMITS.leadMaxMinutes);
  });

  it('calcula o prazo a partir da detecção', () => {
    const detectadoEm = '2026-11-13T12:00:00.000Z';
    expect(deadlineFor('POOL', detectadoEm, { poolMinutes: 3, leadMinutes: 30 })).toBe(
      '2026-11-13T12:03:00.000Z',
    );
    expect(deadlineFor('NORMAL', detectadoEm, { poolMinutes: 3, leadMinutes: 30 })).toBe(
      '2026-11-13T12:30:00.000Z',
    );
  });

  it('usa o contador do C2S quando ele encurta o prazo', () => {
    const timing = { poolMinutes: 3, leadMinutes: 30 };
    const detectadoEm = new Date(NOW).toISOString();

    // 90s restantes vs 3 min configurados: o timer manda.
    expect(deadlineWithTimer('POOL', detectadoEm, timing, 90, NOW)).toBe(iso(90_000));
    // 600s restantes vs 180s configurados: o prazo configurado é o menor.
    expect(deadlineWithTimer('POOL', detectadoEm, timing, 600, NOW)).toBe(iso(180_000));
  });

  it('ignora contador ausente, zero ou inválido', () => {
    const timing = { poolMinutes: 3, leadMinutes: 30 };
    const detectadoEm = new Date(NOW).toISOString();
    const esperado = deadlineFor('POOL', detectadoEm, timing);
    expect(deadlineWithTimer('POOL', detectadoEm, timing, undefined, NOW)).toBe(esperado);
    expect(deadlineWithTimer('POOL', detectadoEm, timing, 0, NOW)).toBe(esperado);
    expect(deadlineWithTimer('POOL', detectadoEm, timing, -5, NOW)).toBe(esperado);
    expect(deadlineWithTimer('POOL', detectadoEm, timing, Number.NaN, NOW)).toBe(esperado);
  });

  it('nunca expira janela terminal ou já executada', () => {
    const vencida = { prazoEm: iso(-1) };
    expect(isExpired(makeWindow({ ...vencida }), NOW)).toBe(true);
    expect(isExpired(makeWindow({ ...vencida, estado: 'ACAO_EXECUTADA' }), NOW)).toBe(false);
    expect(isExpired(makeWindow({ ...vencida, estado: 'EXPIRADO' }), NOW)).toBe(false);
    expect(isExpired(makeWindow({ ...vencida, estado: 'INTERACAO_CONFIRMADA' }), NOW)).toBe(false);
  });

  it('classifica a saúde da janela', () => {
    expect(windowHealth(makeWindow({ detectadoEm: iso(-60_000), prazoEm: iso(600_000) }), NOW)).toBe('NO_PRAZO');
    expect(windowHealth(makeWindow({ detectadoEm: iso(-600_000), prazoEm: iso(90_000) }), NOW)).toBe('ATENCAO');
    expect(windowHealth(makeWindow({ prazoEm: iso(30_000) }), NOW)).toBe('VENCENDO');
    expect(windowHealth(makeWindow({ prazoEm: iso(-1) }), NOW)).toBe('VENCIDA');
  });
});

describe('windowPolicy: regra do Bolsão', () => {
  it('pausa o pool só depois de uma captura sem interação confirmada', () => {
    const detectada = makeWindow({ estado: 'DETECTADO' });
    expect(poolPaused([detectada]).pausado).toBe(false);

    const executada = makeWindow({ estado: 'ACAO_EXECUTADA' });
    const pausa = poolPaused([executada]);
    expect(pausa.pausado).toBe(true);
    expect(pausa.c2sLeadId).toBe('123');

    const confirmada = makeWindow({
      estado: 'INTERACAO_CONFIRMADA',
      interacaoConfirmadaEm: iso(0),
    });
    expect(poolPaused([confirmada]).pausado).toBe(false);
  });

  it('lead normal executado não trava o Bolsão', () => {
    const normal = makeWindow({ origem: 'NORMAL', acao: 'CRIAR_ATIVIDADE', estado: 'ACAO_EXECUTADA' });
    expect(poolPaused([normal]).pausado).toBe(false);
  });

  it('escolhe Bolsão antes do lead normal', () => {
    const normal = makeWindow({ id: 'n', c2sLeadId: '9', origem: 'NORMAL', prazoEm: iso(10_000) });
    const pool = makeWindow({ id: 'p', c2sLeadId: '1', origem: 'POOL', prazoEm: iso(180_000) });
    expect(selectNext([normal, pool], NOW)?.id).toBe('p');
  });

  it('não escolhe pool enquanto o pool está pausado', () => {
    const protegido = makeWindow({ id: 'protegido', c2sLeadId: '1', estado: 'ACAO_EXECUTADA' });
    const outro = makeWindow({ id: 'outro', c2sLeadId: '2' });
    const normal = makeWindow({ id: 'normal', c2sLeadId: '3', origem: 'NORMAL', acao: 'CRIAR_ATIVIDADE' });
    expect(selectNext([protegido, outro, normal], NOW)?.id).toBe('normal');
  });

  it('respeita backoff e bloqueio definitivo', () => {
    const backoff = makeWindow({ id: 'backoff', proximaTentativaEm: iso(30_000) });
    const definitivo = makeWindow({ id: 'definitivo', estado: 'BLOQUEADO', bloqueioRetentavel: false });
    const elegivel = makeWindow({ id: 'elegivel', prazoEm: iso(60_000) });
    expect(isActionable(backoff, NOW)).toBe(false);
    expect(isActionable(definitivo, NOW)).toBe(false);
    expect(selectNext([backoff, definitivo, elegivel], NOW)?.id).toBe('elegivel');
  });

  it('bloqueio retentável volta a ser elegível', () => {
    const retentavel = makeWindow({ estado: 'BLOQUEADO', bloqueioRetentavel: true });
    expect(isActionable(retentavel, NOW)).toBe(true);
  });
});

describe('windowPolicy: dedupe e backoff', () => {
  it('só cria janela para lead novo ou fora da proteção contra duplicidade', () => {
    const candidato = { c2sLeadId: '42', origem: 'POOL' as const, confianca: 'ALTA' as const };
    expect(shouldCreateWindow(candidato, [], { now: NOW, dedupeHours: 24 })).toBe(true);

    const ativa = makeWindow({ c2sLeadId: '42', estado: 'DETECTADO' });
    expect(shouldCreateWindow(candidato, [ativa], { now: NOW, dedupeHours: 24 })).toBe(false);

    const expiradaRecente = makeWindow({
      c2sLeadId: '42',
      estado: 'EXPIRADO',
      prazoEm: iso(-60_000),
      atualizadoEm: iso(-60_000),
    });
    expect(shouldCreateWindow(candidato, [expiradaRecente], { now: NOW, dedupeHours: 24 })).toBe(false);

    const expiradaAntiga = makeWindow({
      c2sLeadId: '42',
      estado: 'EXPIRADO',
      prazoEm: iso(-25 * 3_600_000),
      atualizadoEm: iso(-25 * 3_600_000),
    });
    expect(shouldCreateWindow(candidato, [expiradaAntiga], { now: NOW, dedupeHours: 24 })).toBe(true);
  });

  it('cresce o backoff até o teto', () => {
    expect(backoffFor(0)).toBe(WINDOW_LIMITS.backoffBaseMs);
    expect(backoffFor(1)).toBe(WINDOW_LIMITS.backoffBaseMs * 2);
    expect(backoffFor(50)).toBe(WINDOW_LIMITS.backoffMaxMs);
  });
});

describe('windowPolicy: estados', () => {
  it('conta estados e lista o que precisa de atenção', () => {
    const janelas = [
      makeWindow({ id: 'a', estado: 'DETECTADO' }),
      makeWindow({ id: 'b', estado: 'EXPIRADO', prazoEm: iso(-1) }),
      makeWindow({ id: 'c', estado: 'ACAO_EXECUTADA' }),
      makeWindow({ id: 'd', estado: 'BLOQUEADO', bloqueioRetentavel: true }),
    ];
    const stats = statsOf(janelas);
    expect(stats.DETECTADO).toBe(1);
    expect(stats.EXPIRADO).toBe(1);
    expect(stats.ACAO_EXECUTADA).toBe(1);
    expect(stats.BLOQUEADO).toBe(1);

    const atencao = needsAttention(janelas, NOW).map((window) => window.id);
    // Expirada é estado terminal: vira métrica, não pede atenção humana.
    expect(atencao).not.toContain('b');
    expect(atencao).toContain('c');
    expect(atencao).toContain('d');
    expect(atencao).not.toContain('a');
  });

  it('reconhece estados terminais', () => {
    expect(isTerminal(makeWindow({ estado: 'FALHA' }))).toBe(true);
    expect(isTerminal(makeWindow({ estado: 'INTERACAO_CONFIRMADA' }))).toBe(true);
    expect(isTerminal(makeWindow({ estado: 'EXPIRADO' }))).toBe(true);
    expect(isTerminal(makeWindow({ estado: 'ACAO_PENDENTE' }))).toBe(false);
  });
});
