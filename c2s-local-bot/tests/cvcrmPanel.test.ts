import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARM_EVENT, installConfirmGuard } from '@/content/cvcrm/confirmGuard';
import { executarMovimento } from '@/content/cvcrm/executor';
import { readKanban, readToastLeadIds } from '@/content/cvcrm/kanbanReader';
import { findAnchor, readPanel } from '@/content/cvcrm/panelReader';

/**
 * Testes de DOM com o markup real do CV CRM.
 *
 * Os fixtures abaixo são recortes literais do que o CRM entrega:
 *  - painel `.situacoes-workflow` com o lead 91293 (etapa 2 ativa);
 *  - kanban `.aw-flow-col` com `situacoes][]=N` na querystring do cabeçalho;
 *  - card com `a.lead-lite[data-lead]` e "Na situação N dia(s)".
 *
 * O DOM é montado no `document` global para que os handlers inline
 * (`onclick="modificarSituacao(...)"`) funcionem de verdade — é exatamente o
 * caminho que o executor percorre em produção.
 */

const URL_LEAD = 'https://abiatar.cvcrm.com.br/corretor/comercial/leads/91293/administrar?tk=261115114109';

interface PainelOptions {
  /** Qual etapa está com `class="status ativo"`. */
  ativo?: number | null;
  /** Quantos painéis `.situacoes-workflow` renderizar. */
  workflows?: number;
  /** Remove o `#form_situacao`. */
  semForm?: boolean;
  /** Substitui o `<a>` da etapa 4 por um span bloqueado. */
  alvoIndisponivel?: boolean;
}

function blocoWorkflow(opcoes: PainelOptions): string {
  const ativo = opcoes.ativo === undefined ? 2 : opcoes.ativo;
  const classe = (id: number): string => (ativo === id ? 'status ativo' : 'status inativo');

  const alvo = opcoes.alvoIndisponivel
    ? `<span id="4" class="${classe(4)}" title="Indisponível">Em Atendimento</span>`
    : `<a href="javascript:void(0)" onclick="modificarSituacao('4','Em Atendimento');">
         <span id="4" class="${classe(4)}">Em Atendimento</span>
       </a>`;

  return `
    <div class="situacoes-workflow hideAll">
      <a href="javascript:void(0)" onclick="modificarSituacao('1','Aguardando Atendimento');">
        <span id="1" class="${classe(1)}">Aguardando Atendimento</span>
      </a>
      <span id="2" class="${classe(2)}" rel="tooltip" title="Indisponível">Aguardando Atendimento Corretor</span>
      ${alvo}
      <span id="9" class="${classe(9)}" rel="tooltip" title="Indisponível">Visita Agendada</span>
      <a href="javascript:void(0)" onclick="chamaFacebox('/corretor/comercial/leads/91293/administrar/cancelar_lead', 400, 350);">
        <span id="3" class="${classe(3)}">Descartado</span>
      </a>
      <a href="javascript:void(0)" onclick="modificarSituacao('11','Leads Vencidos ');">
        <span id="11" class="${classe(11)}">Leads Vencidos </span>
      </a>
      <span id="15" class="${classe(15)}" title="Indisponível">Com Restrição</span>
    </div>
  `;
}

function montarPagina(opcoes: PainelOptions = {}): void {
  const blocos = Array.from({ length: opcoes.workflows ?? 1 }, () => blocoWorkflow(opcoes)).join('');
  const form = opcoes.semForm
    ? ''
    : `<form method="post" id="form_situacao">
         <input name="acao" type="hidden" value="alterarSituacao">
         <input name="situacao_para" id="situacao_para" type="hidden" value="">
       </form>`;

  document.body.innerHTML = `${blocos}${form}`;
}

interface CrmFake {
  chamadas: Array<{ para: string; nome: string }>;
  /** Valores de `#situacao_para` que passaram pelo confirm. */
  aplicados: string[];
}

/** Removedores registrados por teste, limpos no `afterEach`. */
const limpezas: Array<() => void> = [];

/** Mesmo regex do executor: extrai o alvo de `modificarSituacao('<id>','<label>')`. */
const MODIFICAR = /modificarSituacao\(\s*'(\d{1,3})'\s*,\s*'([^']*)'\s*\)/;

/**
 * Simula o `modificarSituacao` do CRM.
 *
 * Não dá para definir um global que o handler inline do jsdom enxergue (o
 * `with (window)` dele aponta para a implementação interna, não para o objeto
 * global do teste). Então o comportamento nativo é reproduzido num listener em
 * fase de captura no `document`: ele intercepta o clique antes do handler
 * inline, exatamente como o CRM faz na vida real (confirm → `#situacao_para`
 * → submit).
 */
function instalarCrmFake(leadId = '91293'): CrmFake {
  const chamadas: CrmFake['chamadas'] = [];
  const aplicados: string[] = [];

  const handler = (event: Event): void => {
    const alvo = event.target as Element | null;
    const ancora = alvo?.closest?.('a[onclick]');
    if (!ancora) return;

    const onclick = ancora.getAttribute('onclick') ?? '';
    const modificar = MODIFICAR.exec(onclick);
    if (!modificar) return; // `chamaFacebox`, etc: o CRM também não mudaria etapa

    // Captura: o handler inline do CRM não roda; nós fazemos o papel dele.
    event.preventDefault();
    event.stopPropagation();

    const para = modificar[1] ?? '';
    const nome = modificar[2] ?? '';
    chamadas.push({ para, nome });

    const ok = window.confirm(`Deseja realmente alterar o lead #${leadId} para ${nome} ?`);
    if (!ok) return;

    aplicados.push(para);
    const campo = document.querySelector<HTMLInputElement>('#situacao_para');
    if (campo) campo.value = para;
  };

  document.addEventListener('click', handler, true);
  limpezas.push(() => document.removeEventListener('click', handler, true));

  return { chamadas, aplicados };
}

function armar(leadId: string): void {
  window.dispatchEvent(new CustomEvent(ARM_EVENT, { detail: JSON.stringify({ leadId }) }));
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__C2S_CV_GUARD__;
  window.confirm = vi.fn(() => false);
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const limpar of limpezas.splice(0)) limpar();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* readPanel                                                          */
/* ------------------------------------------------------------------ */

describe('readPanel', () => {
  it('lê a etapa 2 ativa e só considera acionável quem tem modificarSituacao', () => {
    montarPagina({ ativo: 2 });

    const leitura = readPanel(document, URL_LEAD);

    expect(leitura.leadId).toBe('91293');
    expect(leitura.atual).toBe(2);
    expect(leitura.workflows).toBe(1);
    expect(leitura.temForm).toBe(true);

    const porId = new Map(leitura.etapas.map((etapa) => [etapa.id, etapa]));
    expect(porId.get(2)?.ativo).toBe(true);
    expect(porId.get(2)?.acionavel).toBe(false); // span cinza, sem <a>
    expect(porId.get(4)?.acionavel).toBe(true);
    expect(porId.get(1)?.acionavel).toBe(true);
    expect(porId.get(11)?.acionavel).toBe(true);
    // `Descartado` usa chamaFacebox: nunca é acionável.
    expect(porId.get(3)?.acionavel).toBe(false);
    expect(porId.get(9)?.acionavel).toBe(false);
    expect(porId.get(15)?.acionavel).toBe(false);
  });

  it('preserva o rótulo com espaço à direita da etapa 11', () => {
    montarPagina();
    const onze = readPanel(document, URL_LEAD).etapas.find((etapa) => etapa.id === 11);
    expect(onze?.label).toBe('Leads Vencidos');
  });

  it('lê a etapa 4 ativa (pós-check do movimento)', () => {
    montarPagina({ ativo: 4 });
    expect(readPanel(document, URL_LEAD).atual).toBe(4);
  });

  it('devolve atual=null quando nenhum status está ativo', () => {
    montarPagina({ ativo: null });
    expect(readPanel(document, URL_LEAD).atual).toBeNull();
  });

  it('sinaliza painel duplicado e form ausente', () => {
    montarPagina({ workflows: 2, semForm: true });
    const leitura = readPanel(document, URL_LEAD);
    expect(leitura.workflows).toBe(2);
    expect(leitura.temForm).toBe(false);
  });

  it('cai no `var de = "<id>"` quando a URL não traz o lead', () => {
    montarPagina();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<script>var de = "91293"; function modificarSituacao(p, n) {}</script>`,
    );

    const leitura = readPanel(document, 'https://abiatar.cvcrm.com.br/corretor/comercial/algumapagina');
    expect(leitura.leadId).toBe('91293');
  });

  it('não inventa lead id quando não há nenhuma fonte', () => {
    montarPagina();
    expect(readPanel(document, 'https://abiatar.cvcrm.com.br/x').leadId).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* findAnchor                                                         */
/* ------------------------------------------------------------------ */

describe('findAnchor', () => {
  it('devolve o <a> nativo da etapa 4', () => {
    montarPagina();
    const ancora = findAnchor(document, 4);
    expect(ancora).not.toBeNull();
    expect(ancora?.getAttribute('onclick')).toContain("modificarSituacao('4','Em Atendimento')");
  });

  it('nunca devolve o <a> do Descartado (chamaFacebox)', () => {
    montarPagina();
    expect(findAnchor(document, 3)).toBeNull();
  });

  it('devolve null quando a etapa está bloqueada', () => {
    montarPagina({ alvoIndisponivel: true });
    expect(findAnchor(document, 4)).toBeNull();
  });

  it('devolve null quando o handler aponta para outro id', () => {
    montarPagina();
    const ancora = findAnchor(document, 4);
    if (ancora) ancora.setAttribute('onclick', "modificarSituacao('9','Visita Agendada');");
    expect(findAnchor(document, 4)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* executarMovimento                                                  */
/* ------------------------------------------------------------------ */

describe('executarMovimento', () => {
  it('clica o <a> nativo e leva o lead da etapa 2 para a 4', () => {
    montarPagina({ ativo: 2 });
    const crm = instalarCrmFake();
    const guard = installConfirmGuard(window);

    const resultado = executarMovimento(document, window, '91293', { url: URL_LEAD });

    expect(resultado).toEqual({
      ok: true,
      motivo: 'CLIQUE_ENVIADO',
      acao: 'CLIQUE',
      etapaAntes: 2,
    });
    expect(crm.chamadas).toEqual([{ para: '4', nome: 'Em Atendimento' }]);
    expect(crm.aplicados).toEqual(['4']);
    expect(document.querySelector<HTMLInputElement>('#situacao_para')?.value).toBe('4');
    expect(guard.armado()).toBeNull(); // o arm foi consumido por um único confirm
  });

  it('nunca escreve no CRM quando o lead já está no alvo', () => {
    montarPagina({ ativo: 4 });
    const crm = instalarCrmFake();
    installConfirmGuard(window);

    const resultado = executarMovimento(document, window, '91293', { url: URL_LEAD });

    expect(resultado).toMatchObject({ ok: true, acao: 'NENHUMA', motivo: 'JA_ESTA_NO_ALVO' });
    expect(crm.chamadas).toHaveLength(0);
  });

  it('recusa lead fora da coluna de entrada', () => {
    montarPagina({ ativo: 1 });
    const crm = instalarCrmFake();
    installConfirmGuard(window);

    const resultado = executarMovimento(document, window, '91293', { url: URL_LEAD });

    expect(resultado).toMatchObject({ ok: false, acao: 'NENHUMA', motivo: 'NAO_E_DA_COLUNA_DE_ENTRADA' });
    expect(crm.chamadas).toHaveLength(0);
  });

  it('recusa quando o lead da página não é o lead pedido', () => {
    montarPagina({ ativo: 2 });
    const crm = instalarCrmFake();
    installConfirmGuard(window);

    const resultado = executarMovimento(document, window, '99999', { url: URL_LEAD });

    expect(resultado).toMatchObject({ ok: false, acao: 'NENHUMA', motivo: 'LEAD_DIVERGENTE' });
    expect(crm.chamadas).toHaveLength(0);
  });

  it('recusa quando o alvo está indisponível (sem <a>)', () => {
    montarPagina({ ativo: 2, alvoIndisponivel: true });
    const crm = instalarCrmFake();
    installConfirmGuard(window);

    const resultado = executarMovimento(document, window, '91293', { url: URL_LEAD });

    expect(resultado).toMatchObject({ ok: false, acao: 'NENHUMA', motivo: 'ALVO_INDISPONIVEL' });
    expect(crm.chamadas).toHaveLength(0);
  });

  it('recusa com painel duplicado', () => {
    montarPagina({ ativo: 2, workflows: 2 });
    instalarCrmFake();
    installConfirmGuard(window);

    const resultado = executarMovimento(document, window, '91293', { url: URL_LEAD });
    expect(resultado).toMatchObject({ ok: false, motivo: 'WORKFLOW_AMBIGUO' });
  });

  it('respeita o agendamento do clique (resposta antes da navegação)', () => {
    montarPagina({ ativo: 2 });
    const crm = instalarCrmFake();
    installConfirmGuard(window);

    let pendente: (() => void) | null = null;
    const resultado = executarMovimento(document, window, '91293', {
      url: URL_LEAD,
      agendar: (acao) => {
        pendente = acao;
      },
    });

    expect(resultado.acao).toBe('CLIQUE');
    expect(crm.chamadas).toHaveLength(0); // ainda não clicou
    expect(typeof pendente).toBe('function');

    (pendente as unknown as () => void)();
    expect(crm.chamadas).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* confirmGuard                                                       */
/* ------------------------------------------------------------------ */

describe('confirmGuard', () => {
  it('aceita só o confirm do lead armado, com o texto do CRM', () => {
    window.confirm = vi.fn(() => false);
    const guard = installConfirmGuard(window);

    armar('91293');
    expect(guard.armado()).toBe('91293');

    expect(window.confirm('Deseja realmente alterar o lead #91293 para Em Atendimento ?')).toBe(true);
    expect(guard.armado()).toBeNull();

    // Fora do arm, a decisão volta a ser do corretor.
    expect(window.confirm('Deseja realmente alterar o lead #91293 para Em Atendimento ?')).toBe(false);
  });

  it('nunca aceita o confirm de outro lead', () => {
    const original = vi.fn(() => false);
    window.confirm = original;
    const guard = installConfirmGuard(window);

    armar('91293');
    expect(window.confirm('Deseja realmente alterar o lead #11111 para Em Atendimento ?')).toBe(false);
    expect(original).toHaveBeenCalledTimes(1);
    expect(guard.armado()).toBe('91293'); // arm continua válido
  });

  it('exige o texto exato do CRM (não aceita mensagem genérica)', () => {
    window.confirm = vi.fn(() => false);
    installConfirmGuard(window);

    armar('91293');
    expect(window.confirm('Tem certeza?')).toBe(false);
  });

  it('expira o arm depois do TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T12:00:00.000Z'));
    window.confirm = vi.fn(() => false);
    installConfirmGuard(window, 1_000);

    armar('91293');
    vi.setSystemTime(new Date('2026-11-15T12:00:02.000Z'));

    expect(window.confirm('Deseja realmente alterar o lead #91293 para Em Atendimento ?')).toBe(false);
  });

  it('ignora payload inválido sem armar nada', () => {
    window.confirm = vi.fn(() => false);
    const guard = installConfirmGuard(window);

    window.dispatchEvent(new CustomEvent(ARM_EVENT, { detail: '{"leadId":"12abc"}' }));
    expect(guard.armado()).toBeNull();

    window.dispatchEvent(new CustomEvent(ARM_EVENT, { detail: 'nao-e-json' }));
    expect(guard.armado()).toBeNull();
  });

  it('instala uma única vez por janela', () => {
    window.confirm = vi.fn(() => false);
    installConfirmGuard(window);
    const depoisDoPrimeiro = window.confirm;

    installConfirmGuard(window);
    expect(window.confirm).toBe(depoisDoPrimeiro);
  });
});

/* ------------------------------------------------------------------ */
/* kanban                                                             */
/* ------------------------------------------------------------------ */

const COLUNA_ENTRADA = `
  <div class="aw-flow-col " style="width: 300px;">
    <div class="aw-flow-head p-l-15 p-r-15">
      <div class="aw-flow-head-titulo"><span class="titulo">Aguardando Atendimento C...</span></div>
      <div class="aw-flow-head-line">
        <a target="_blank" href="https://abiatar.cvcrm.com.br/corretor/comercial/leads?q[999|situacoes][]=2">
          <span>2 Registro(s) - Total Negócio R$ 0,00</span>
        </a>
      </div>
    </div>
    <div class="aw-flow-list" style="height: 1509px;">
      <div class="aw-flow-item-vcard">
        <div class="cv-card" style="border-left: 3px solid #ffcf01">
          <div class="cv-card-titulo">
            <div>
              <h3>#91293</h3>
              <span>Aguardando Atendimento C...</span>
            </div>
            <div class="cv-card-bts">
              <a data-lead="91293" href="javascript:void(0);" class="lead-lite">
                <i class="fa fa-fw fa-eye"></i>
              </a>
            </div>
          </div>
          <div class="cv-card-lista">
            <div class="cv-card-info-item-wrap">
              <div class="cv-card-info-item">
                <p>Criado há</p><h4><b>4</b> <span>dia(s)</span></h4>
              </div>
              <div class="cv-card-info-item">
                <p>Na situação</p><h4><b>0</b> <span>dia(s)</span></h4>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="aw-flow-item-vcard">
        <div class="cv-card" style="border-left: 3px solid #ffcf01">
          <div class="cv-card-titulo">
            <div><h3>#91300</h3><span>Aguardando Atendimento C...</span></div>
            <div class="cv-card-bts">
              <a data-lead="91300" href="javascript:void(0);" class="lead-lite"></a>
            </div>
          </div>
          <div class="cv-card-lista">
            <div class="cv-card-info-item-wrap">
              <div class="cv-card-info-item"><p>Criado há</p><h4><b>1</b> <span>dia(s)</span></h4></div>
              <div class="cv-card-info-item"><p>Na situação</p><h4><b>1</b> <span>dia(s)</span></h4></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const COLUNA_ATENDIMENTO = `
  <div class="aw-flow-col " style="width: 300px;">
    <div class="aw-flow-head">
      <div class="aw-flow-head-titulo"><span class="titulo">Em Atendimento</span></div>
      <div class="aw-flow-head-line">
        <a href="https://abiatar.cvcrm.com.br/corretor/comercial/leads?q[999|situacoes][]=4">
          <span>9 Registro(s) - Total Negócio R$ 0,00</span>
        </a>
      </div>
    </div>
    <div class="aw-flow-list">
      <div class="aw-flow-item-vcard">
        <div class="cv-card">
          <div class="cv-card-titulo">
            <div><h3>#91291</h3><span>Em Atendimento</span></div>
            <div class="cv-card-bts"><a data-lead="91291" class="lead-lite" href="javascript:void(0);"></a></div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

describe('readKanban', () => {
  it('identifica a etapa pelo id da coluna, nunca pelo rótulo truncado', () => {
    document.body.innerHTML = `<div class="aw-flow">${COLUNA_ENTRADA}${COLUNA_ATENDIMENTO}</div>`;

    const leads = readKanban(document);
    const porId = new Map(leads.map((lead) => [lead.leadId, lead]));

    expect(porId.get('91293')?.etapa).toBe(2);
    expect(porId.get('91300')?.etapa).toBe(2);
    expect(porId.get('91291')?.etapa).toBe(4);
    expect(leads).toHaveLength(3);
  });

  it('lê "Na situação" e "Criado" em dias', () => {
    document.body.innerHTML = COLUNA_ENTRADA;
    const [primeiro] = readKanban(document);
    expect(primeiro).toMatchObject({ leadId: '91293', diasNaSituacao: 0, criadoDias: 4 });
  });

  it('ignora coluna sem link de etapa e card sem lead id', () => {
    document.body.innerHTML = `
      <div class="aw-flow-col">
        <div class="aw-flow-list">
          <div class="cv-card"><div class="cv-card-titulo"><div><h3>#123</h3></div></div></div>
        </div>
      </div>
    `;
    expect(readKanban(document)).toEqual([]);
  });

  it('cai no `#<id>` do título quando falta o data-lead', () => {
    document.body.innerHTML = `
      <div class="aw-flow-col">
        <div class="aw-flow-head"><a href="/x?q[999|situacoes][]=2">x</a></div>
        <div class="aw-flow-list">
          <div class="cv-card"><div class="cv-card-titulo"><div><h3>#91455</h3></div></div></div>
        </div>
      </div>
    `;
    expect(readKanban(document)).toEqual([
      { leadId: '91455', etapa: 2, diasNaSituacao: null, criadoDias: null },
    ]);
  });

  it('não duplica o mesmo lead em duas colunas', () => {
    document.body.innerHTML = `<div class="aw-flow">${COLUNA_ENTRADA}${COLUNA_ENTRADA}</div>`;
    const leads = readKanban(document);
    expect(leads.filter((lead) => lead.leadId === '91293')).toHaveLength(1);
  });
});

describe('readToastLeadIds', () => {
  it('lê o id anunciado pelo próprio CRM', () => {
    document.body.innerHTML = `
      <div id="toast-container" class="toast-top-right">
        <div class="toast toast-info">
          <div class="toast-message">Novo lead! ID Lead: 91294 — Aguardando Atendimento</div>
        </div>
      </div>
    `;
    expect(readToastLeadIds(document)).toEqual(['91294']);
  });

  it('ignora toast sem ID Lead e id inválido', () => {
    document.body.innerHTML = `
      <div id="toast-container">
        <div class="toast"><div class="toast-message">Registro salvo com sucesso</div></div>
        <div class="toast"><div class="toast-message">ID Lead: 12abc</div></div>
      </div>
    `;
    expect(readToastLeadIds(document)).toEqual([]);
  });

  it('devolve vazio quando não há container', () => {
    expect(readToastLeadIds(document)).toEqual([]);
  });
});
