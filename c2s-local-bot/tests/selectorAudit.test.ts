import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSelectorAudit } from '@/content/actions/selectorAudit';

/** jsdom não calcula layout: sem isso `isVisible` diria que tudo está oculto. */
function stubLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 120,
    height: 40,
    top: 0,
    left: 0,
    right: 120,
    bottom: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function badge(total: number, hidden = false): void {
  const element = document.createElement('span');
  element.id = 'badged_bolsao';
  element.textContent = String(total);
  if (hidden) element.hidden = true;
  document.body.appendChild(element);
}

function activeCard(c2sLeadId: string, options: { segundos?: number; nome?: string } = {}): void {
  const card = document.createElement('div');
  card.className = 'bucket-lead-card';
  card.setAttribute('data-lead-id', c2sLeadId);
  if (options.nome) {
    const name = document.createElement('strong');
    name.className = 'customer-name';
    name.textContent = options.nome;
    card.appendChild(name);
  }
  if (options.segundos !== undefined) {
    const time = document.createElement('div');
    time.className = 'bucket-time';
    const count = document.createElement('span');
    count.className = 'timer-count';
    count.setAttribute('data-seconds', String(options.segundos));
    time.appendChild(count);
    card.appendChild(time);
  }
  document.body.appendChild(card);
}

/** O histórico real vive dentro de `.container.bucket-list` — o seletor exige isso. */
function historyCard(): void {
  let list = document.querySelector('.container.bucket-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'container bucket-list';
    document.body.appendChild(list);
  }
  const card = document.createElement('div');
  card.className = 'bucket-at-card';
  card.textContent = 'histórico';
  list.appendChild(card);
}

beforeEach(() => {
  stubLayout();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/webapp/bucket_leads');
});

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('auditoria de seletores: sinais do Bolsão', () => {
  it('acusa seletor quebrado quando o badge indica leads e o parser lê zero', () => {
    badge(2);
    historyCard();

    const report = buildSelectorAudit();

    expect(report.contexto).toBe('BUCKET');
    expect(report.sinais.bolsaoIndicado).toBe(2);
    expect(report.sinais.poolLido).toBe(0);
    expect(report.sinais.cardsAtivos).toBe(0);
    expect(report.sinais.cardsHistorico).toBe(1);
    expect(report.sinais.diagnostico.join(' ')).toContain('seletor do card provavelmente mudou');
    expect(report.conceitosSemMatch).toContain('bucketLeadCard');
  });

  it('confirma pool vazio quando o C2S publica zero no badge', () => {
    badge(0);

    const report = buildSelectorAudit();

    expect(report.sinais.bolsaoIndicado).toBe(0);
    expect(report.sinais.diagnostico.join(' ')).toContain('Bolsão vazio');
    expect(report.sinais.diagnostico.join(' ')).not.toContain('seletor');
  });

  it('não usa badge oculto como testemunha', () => {
    badge(5, true);

    const report = buildSelectorAudit();

    expect(report.sinais.bolsaoIndicado).toBeUndefined();
    expect(report.sinais.diagnostico.join(' ')).toContain('não publicou contagem');
  });

  it('lê id e prazo do card ativo sem vazar nome do lead', () => {
    badge(1);
    activeCard('987654', { segundos: 90, nome: 'Fulana de Tal' });

    const report = buildSelectorAudit();

    expect(report.sinais.poolLido).toBe(1);
    expect(report.sinais.poolDetalhe).toEqual([
      { c2sLeadId: '987654', segundosRestantes: 90, confianca: expect.any(String) },
    ]);
    expect(report.sinais.contadorSegundos).toBe(90);
    expect(JSON.stringify(report.sinais)).not.toContain('Fulana');
  });

  it('avisa quando o card existe mas está oculto', () => {
    badge(1);
    activeCard('123', { segundos: 30 });
    // Modal real fica no DOM oculto; aqui só precisamos de um card oculto.
    document.querySelector('.bucket-lead-card')?.setAttribute('hidden', '');

    const report = buildSelectorAudit();

    expect(report.sinais.cardsAtivos).toBe(1);
    expect(report.sinais.diagnostico.join(' ')).toContain('ocultos');
  });

  it('lista o modal visível que bloqueia a captura', () => {
    badge(1);
    activeCard('55');
    const modal = document.createElement('div');
    modal.id = 'modal_bucket_lead_not_interacted';
    document.body.appendChild(modal);

    const report = buildSelectorAudit();

    expect(report.sinais.modaisVisiveis).toContain('bucketNotInteractedModal');
  });
});
