import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { emptyCvState } from '@/shared/analysis/cvcrmPolicy';
import { cvcrmLiberado, motivosCvcrm, requisitosCvcrm } from '@/background/cvcrm/cvcrmGate';
import type { Settings } from '@/shared/types/settings';

const TUDO_LIGADO: Settings = {
  ...DEFAULT_SETTINGS,
  automationOptInAt: '2026-11-16T10:00:00.000Z',
  botActive: true,
  inspectMode: false,
  cvcrmEnabled: true,
  cvcrmAutoMove: true,
};

const COM_BASELINE = { ...emptyCvState(), baselineEm: '2026-11-16T10:00:00.000Z' };

/**
 * O gate é a resposta para "por que está Bloqueado?". Se ele não listar o item
 * que falta, o corretor fica sem saída.
 */
describe('gate do CV CRM', () => {
  it('lista todos os requisitos, sempre na mesma ordem', () => {
    const chaves = requisitosCvcrm(TUDO_LIGADO, COM_BASELINE, 'VALIDA').map((requisito) => requisito.chave);
    expect(chaves).toEqual(['BUILD', 'OPT_IN', 'ROBO', 'INSPECAO', 'LICENCA', 'MODULO', 'MOVER', 'BASELINE']);
  });

  it('com tudo em ordem, não sobra nenhum motivo (fora o flag de build)', () => {
    const requisitos = requisitosCvcrm(TUDO_LIGADO, COM_BASELINE, 'VALIDA');
    const pendentes = requisitos.filter((requisito) => !requisito.ok);

    // `BUILD` depende do binário; o teste não pode exigir automação ligada.
    expect(pendentes.every((requisito) => requisito.chave === 'BUILD')).toBe(true);
    expect(motivosCvcrm(TUDO_LIGADO, COM_BASELINE, 'VALIDA')).toHaveLength(pendentes.length);
  });

  it('aponta cada bloqueio com uma frase própria', () => {
    const padrao = requisitosCvcrm(DEFAULT_SETTINGS, emptyCvState(), 'NAO_CONFIGURADA');
    const motivos = motivosCvcrm(DEFAULT_SETTINGS, emptyCvState(), 'NAO_CONFIGURADA');

    expect(motivos).toContain('Opt-in da automação não registrado.');
    expect(motivos).toContain('Modo inspeção ligado.');
    expect(motivos).toContain('Módulo CV CRM desligado.');
    expect(motivos).toContain('Mover etapa desligado.');
    expect(motivos).toContain('Linha de base não definida.');
    expect(motivos).toContain('Licença: NAO_CONFIGURADA.');

    for (const requisito of padrao.filter((item) => !item.ok)) {
      expect(requisito.motivo, requisito.chave).toBeTruthy();
    }
  });

  it('licença em tolerância offline ainda libera', () => {
    const requisitos = requisitosCvcrm(TUDO_LIGADO, COM_BASELINE, 'TOLERANCIA_OFFLINE');
    expect(requisitos.find((requisito) => requisito.chave === 'LICENCA')?.ok).toBe(true);
  });

  it('licença expirada bloqueia, mesmo com o resto pronto', () => {
    const requisitos = requisitosCvcrm(TUDO_LIGADO, COM_BASELINE, 'EXPIRADA');
    const licenca = requisitos.find((requisito) => requisito.chave === 'LICENCA');

    expect(licenca?.ok).toBe(false);
    expect(cvcrmLiberado(TUDO_LIGADO, COM_BASELINE)).toBe(false);
  });

  it('robô pausado e inspeção ligada também bloqueiam', () => {
    const pausado = requisitosCvcrm({ ...TUDO_LIGADO, botActive: false }, COM_BASELINE, 'VALIDA');
    const inspecao = requisitosCvcrm({ ...TUDO_LIGADO, inspectMode: true }, COM_BASELINE, 'VALIDA');

    expect(pausado.find((requisito) => requisito.chave === 'ROBO')?.ok).toBe(false);
    expect(inspecao.find((requisito) => requisito.chave === 'INSPECAO')?.ok).toBe(false);
  });
});
