import { afterEach, describe, expect, it } from 'vitest';
import {
  CVRM_ENTRADA,
} from '@/shared/constants/cvcrm';
import {
  adminUrl,
  comMovimento,
  cvUrlInfo,
  decidirMovimento,
  elegiveisParaPainel,
  emptyCvState,
  iniciarBaseline,
  mergeKanban,
  selectElegivel,
  timingFrom,
} from '@/shared/analysis/cvcrmPolicy';
import type { CvKanbanLead, CvMove, CvPanelReading } from '@/shared/types/cvcrm';

const AGORA = new Date('2026-11-15T12:00:00.000Z').getTime();
const ISO = new Date(AGORA).toISOString();
const TIMING = { atrasoMs: 5_000, idadeMaxMs: 2 * 60 * 60_000 };

function leitura(parcial: Partial<CvPanelReading> = {}): CvPanelReading {
  return {
    leadId: '91293',
    atual: CVRM_ENTRADA,
    etapas: [
      { id: 1, label: 'Aguardando Atendimento', ativo: false, acionavel: true },
      { id: 2, label: 'Aguardando Atendimento Corretor', ativo: true, acionavel: false },
      { id: 4, label: 'Em Atendimento', ativo: false, acionavel: true },
    ],
    workflows: 1,
    temForm: true,
    ...parcial,
  };
}

function lead(leadId: string, etapa = CVRM_ENTRADA): CvKanbanLead {
  return { leadId, etapa, diasNaSituacao: 0, criadoDias: 0 };
}

function movimento(id: string, estado: CvMove['estado'] = 'CLICADO'): CvMove {
  return {
    id,
    leadId: `10${id}`,
    estado,
    criadoEm: ISO,
    atualizadoEm: ISO,
  };
}

afterEach(() => {
  /* nada global: os testes aqui são puros */
});

describe('cvUrlInfo', () => {
  it('reconhece a página do lead e ignora o ?tk= da querystring', () => {
    const info = cvUrlInfo('https://abiatar.cvcrm.com.br/corretor/comercial/leads/91293/administrar?tk=261115114109');
    expect(info.context).toBe('LEAD_ADMIN');
    expect(info.leadId).toBe('91293');
    expect(info.host).toBe('abiatar.cvcrm.com.br');
  });

  it('reconhece o kanban com filtro na querystring', () => {
    const info = cvUrlInfo(
      'https://abiatar.cvcrm.com.br/corretor/comercial/andamentoleads?q%5B999%7Csituacoes%5D%5B%5D=2',
    );
    expect(info.context).toBe('KANBAN');
  });

  it('não confunde a página de edição "lite" com a de administrar', () => {
    expect(cvUrlInfo('https://abiatar.cvcrm.com.br/corretor/comercial/leads/91293/lite').context).toBe('OUTRO');
  });

  it('trata login e host estranho', () => {
    expect(cvUrlInfo('https://abiatar.cvcrm.com.br/login').context).toBe('LOGIN');
    expect(cvUrlInfo('https://api.contact2sale.com/x').context).toBe('OUTRO');
    expect(cvUrlInfo('nao-e-url').context).toBe('OUTRO');
  });

  it('monta a URL do lead no tenant correto', () => {
    expect(adminUrl('abiatar.cvcrm.com.br', '91293')).toBe(
      'https://abiatar.cvcrm.com.br/corretor/comercial/leads/91293/administrar',
    );
  });
});

describe('decidirMovimento', () => {
  it('move da entrada para o alvo', () => {
    const decisao = decidirMovimento(leitura());
    expect(decisao).toEqual({
      kind: 'MOVER',
      leadId: '91293',
      de: 2,
      para: 4,
      labelAlvo: 'Em Atendimento',
    });
  });

  it('é idempotente quando o lead já está no alvo', () => {
    const decisao = decidirMovimento(leitura({ atual: 4 }));
    expect(decisao.kind).toBe('NOOP');
  });

  it('recusa lead de outra coluna', () => {
    const decisao = decidirMovimento(leitura({ atual: 1 }));
    expect(decisao).toEqual({ kind: 'BLOQUEADO', motivo: 'NAO_E_DA_COLUNA_DE_ENTRADA' });
  });

  it('recusa quando o alvo está indisponível no workflow', () => {
    const decisao = decidirMovimento(
      leitura({
        etapas: [
          { id: 2, label: 'Aguardando Atendimento Corretor', ativo: true, acionavel: false },
          { id: 4, label: 'Em Atendimento', ativo: false, acionavel: false },
        ],
      }),
    );
    expect(decisao).toEqual({ kind: 'BLOQUEADO', motivo: 'ALVO_INDISPONIVEL' });
  });

  it('recusa workflow ambíguo (mais de um painel)', () => {
    expect(decidirMovimento(leitura({ workflows: 2 }))).toEqual({
      kind: 'BLOQUEADO',
      motivo: 'WORKFLOW_AMBIGUO',
    });
  });

  it('recusa quando falta o formulário de situação', () => {
    expect(decidirMovimento(leitura({ workflows: 0 }))).toEqual({
      kind: 'BLOQUEADO',
      motivo: 'SEM_FORM',
    });
    expect(decidirMovimento(leitura({ temForm: false }))).toEqual({
      kind: 'BLOQUEADO',
      motivo: 'SEM_FORM',
    });
  });

  it('recusa quando não dá para ler a etapa atual', () => {
    expect(decidirMovimento(leitura({ atual: null }))).toEqual({
      kind: 'BLOQUEADO',
      motivo: 'ETAPA_ATUAL_DESCONHECIDA',
    });
  });

  it('recusa id de lead inválido', () => {
    expect(decidirMovimento(leitura({ leadId: '' }))).toEqual({
      kind: 'BLOQUEADO',
      motivo: 'LEAD_ID_INVALIDO',
    });
    expect(decidirMovimento(leitura({ leadId: '12abc' }))).toEqual({
      kind: 'BLOQUEADO',
      motivo: 'LEAD_ID_INVALIDO',
    });
  });
});

describe('linha de base', () => {
  it('marca todos os leads da entrada como baseline', () => {
    const estado = iniciarBaseline(emptyCvState(), [lead('1'), lead('2', 4)], ISO);
    expect(estado.baselineEm).toBe(ISO);
    expect(estado.baselineIds).toEqual(['1']);
    expect(estado.primeiraVez['1']).toBe(ISO);
  });

  it('nunca move lead da linha de base, mesmo recém-visto', () => {
    const estado = iniciarBaseline(emptyCvState(), [lead('1')], ISO);
    expect(selectElegivel(estado, [lead('1')], AGORA + 60_000, TIMING)).toBeUndefined();
  });
});

describe('selectElegivel', () => {
  const base = mergeKanban(emptyCvState(), [lead('100')], ISO);

  it('espera o atraso configurado', () => {
    expect(selectElegivel({ ...base, baselineEm: ISO }, [lead('100')], AGORA + 4_000, TIMING)).toBeUndefined();
    expect(
      selectElegivel({ ...base, baselineEm: ISO }, [lead('100')], AGORA + 6_000, TIMING)?.leadId,
    ).toBe('100');
  });

  it('descarta lead velho demais (automação ficou bloqueada)', () => {
    const depois = AGORA + TIMING.idadeMaxMs + 1_000;
    expect(selectElegivel({ ...base, baselineEm: ISO }, [lead('100')], depois, TIMING)).toBeUndefined();
  });

  it('nunca retenta lead com movimento registrado', () => {
    const comTentativa = comMovimento({ ...base, baselineEm: ISO }, {
      id: 'm1',
      leadId: '100',
      estado: 'FALHA',
      criadoEm: ISO,
      atualizadoEm: ISO,
    });
    expect(selectElegivel(comTentativa, [lead('100')], AGORA + 60_000, TIMING)).toBeUndefined();
  });

  it('não começa outro movimento com um pendente', () => {
    const pendente = comMovimento({ ...base, baselineEm: ISO }, {
      id: 'm1',
      leadId: '100',
      estado: 'CLICADO',
      criadoEm: ISO,
      atualizadoEm: ISO,
    });
    expect(selectElegivel(pendente, [lead('200'), lead('100')], AGORA + 60_000, TIMING)).toBeUndefined();
  });

  it('ignora quem não está na coluna de entrada', () => {
    expect(selectElegivel({ ...base, baselineEm: ISO }, [lead('100', 4)], AGORA + 60_000, TIMING)).toBeUndefined();
  });

  it('escolhe o mais antigo primeiro', () => {
    const estado = mergeKanban(emptyCvState(), [lead('200')], ISO);
    const depois = mergeKanban(estado, [lead('200'), lead('300')], new Date(AGORA + 10_000).toISOString());
    const escolhido = selectElegivel(
      { ...depois, baselineEm: ISO },
      [lead('300'), lead('200')],
      AGORA + 60_000,
      TIMING,
    );
    expect(escolhido?.leadId).toBe('200');
  });

  it('painel lista elegíveis sem exigir o atraso de clique', () => {
    const painel = elegiveisParaPainel({ ...base, baselineEm: ISO }, [lead('100')], AGORA + 1_000, TIMING);
    expect(painel.map((item) => item.leadId)).toEqual(['100']);
  });
});

describe('mergeKanban', () => {
  it('grava a primeira vez uma única vez', () => {
    const primeiro = mergeKanban(emptyCvState(), [lead('1')], ISO);
    const segundo = mergeKanban(primeiro, [lead('1', 4)], new Date(AGORA + 60_000).toISOString());
    expect(segundo.primeiraVez['1']).toBe(ISO);
    expect(segundo.ultimaEtapa['1']).toBe(4);
  });

  it('ignora ids inválidos', () => {
    const estado = mergeKanban(emptyCvState(), [{ ...lead('x'), leadId: 'x' }], ISO);
    expect(estado.primeiraVez).toEqual({});
  });
});

describe('comMovimento', () => {
  it('substitui pelo id e encerra o pendente', () => {
    const primeiro = comMovimento(emptyCvState(), movimento('1', 'CLICADO'));
    expect(primeiro.pendente?.id).toBe('1');

    const segundo = comMovimento(primeiro, { ...movimento('1', 'CONFIRMADO') });
    expect(segundo.pendente).toBeNull();
    expect(segundo.movimentos).toHaveLength(1);
    expect(segundo.movimentos[0]?.estado).toBe('CONFIRMADO');
  });

  it('nunca rebaixa um movimento já confirmado', () => {
    const confirmado = comMovimento(emptyCvState(), movimento('1', 'CONFIRMADO'));
    const clicadoAtrasado = comMovimento(confirmado, movimento('1', 'CLICADO'));

    expect(clicadoAtrasado).toBe(confirmado);
    expect(clicadoAtrasado.movimentos[0]?.estado).toBe('CONFIRMADO');
    expect(clicadoAtrasado.pendente).toBeNull();
  });

  it('mantém a falha mesmo se o clique for reenviado', () => {
    const falha = comMovimento(emptyCvState(), movimento('1', 'FALHA'));
    const atrasado = comMovimento(falha, movimento('1', 'ARMADO'));
    expect(atrasado.movimentos[0]?.estado).toBe('FALHA');
    expect(atrasado.pendente).toBeNull();
  });

  it('limita o histórico', () => {
    let estado = emptyCvState();
    for (let indice = 0; indice < 130; indice += 1) {
      estado = comMovimento(estado, movimento(String(indice), 'CONFIRMADO'));
    }
    expect(estado.movimentos).toHaveLength(100);
  });
});

describe('timingFrom', () => {
  it('clampa valores absurdos', () => {
    expect(timingFrom(-10, 9_999)).toEqual({
      atrasoMs: 0,
      idadeMaxMs: 168 * 60 * 60_000,
    });
    expect(timingFrom(9_999, 0)).toEqual({
      atrasoMs: 600_000,
      idadeMaxMs: 60 * 60_000,
    });
  });
});
