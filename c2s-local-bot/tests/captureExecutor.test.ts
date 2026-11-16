import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeActivity } from '@/content/actions/activityExecutor';
import { executeCapture, setCaptureSuspended } from '@/content/actions/captureExecutor';

/**
 * jsdom não calcula layout: tudo tem `0x0`. Sem isso, `isVisible` diria que
 * qualquer elemento está escondido e o teste não exercitaria o fluxo real.
 */
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

function goTo(path: string): void {
  window.history.replaceState({}, '', path);
}

beforeEach(() => {
  stubLayout();
  document.body.innerHTML = '';
  goTo('/webapp/bucket_leads');
  setCaptureSuspended(false);
});

afterEach(() => {
  setCaptureSuspended(false);
  document.body.innerHTML = '';
  goTo('/');
});

/**
 * O card real do C2S traz o id no `onclick="openModalTakeLead(...)"`, mas o
 * jsdom executa handlers inline num contexto isolado: definir a função global
 * no teste não basta e o clique estouraria `ReferenceError`. O parser de
 * `onclick` já é coberto em `parsers.test.ts`; aqui usamos `data-lead-id`, que
 * o mesmo `extractLeadId` reconhece, para exercitar o fluxo de clique.
 */
function bucketCard(c2sLeadId: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bucket-lead-card';
  card.setAttribute('data-lead-id', c2sLeadId);
  card.textContent = 'Lead de teste';
  document.body.appendChild(card);
  return card;
}

describe('captureExecutor: recusas sem tocar na página', () => {
  it('recusa quando o card não está no DOM', async () => {
    const result = await executeCapture('123', 0, 0);
    expect(result.ok).toBe(false);
    expect(result.motivo).toBe('CARD_AUSENTE');
    expect(result.retentavel).toBe(true);
  });

  it('recusa enquanto o modo inspeção está ligado', async () => {
    bucketCard('123');
    setCaptureSuspended(true);
    const result = await executeCapture('123', 0, 0);
    expect(result.ok).toBe(false);
    expect(result.motivo).toBe('INSPECAO_ATIVA');
  });

  it('ignora card de histórico e exige o card ativo do Bolsão', async () => {
    const historico = document.createElement('div');
    historico.className = 'bucket-at-card';
    historico.setAttribute('data-lead-id', '999');
    document.body.appendChild(historico);

    const result = await executeCapture('999', 0, 0);
    expect(result.ok).toBe(false);
    expect(result.motivo).toBe('CARD_AUSENTE');
  });
});

describe('captureExecutor: fluxo click-first', () => {
  it('clica no card, confirma uma única vez e reconhece a navegação', async () => {
    const card = bucketCard('555');
    let cliquesNoCard = 0;
    let cliquesNoConfirmar = 0;

    card.addEventListener('click', () => {
      cliquesNoCard += 1;
      const modal = document.createElement('div');
      modal.id = 'modal_bucket_lead';
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      const confirmar = document.createElement('button');
      confirmar.className = 'btn-primary';
      confirmar.textContent = 'Pegar lead';
      confirmar.addEventListener('click', () => {
        cliquesNoConfirmar += 1;
        modal.remove();
        goTo('/webapp/leads/555');
      });
      footer.appendChild(confirmar);
      modal.appendChild(footer);
      document.body.appendChild(modal);
    });

    const result = await executeCapture('555', 0, 0);
    expect(result.ok).toBe(true);
    expect(result.motivo).toBe('SUCESSO');
    expect(cliquesNoCard).toBe(1);
    expect(cliquesNoConfirmar).toBe(1);
  });

  it('não confirma quando o C2S abre o modal de lead já capturado', async () => {
    const card = bucketCard('777');
    let cliquesNoConfirmar = 0;

    card.addEventListener('click', () => {
      // Modal de captura e modal de recusa coexistem: a recusa tem
      // precedência e o botão de confirmar nunca é clicado.
      const modal = document.createElement('div');
      modal.id = 'modal_bucket_lead';
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      const confirmar = document.createElement('button');
      confirmar.className = 'btn-primary';
      confirmar.addEventListener('click', () => {
        cliquesNoConfirmar += 1;
      });
      footer.appendChild(confirmar);
      modal.appendChild(footer);
      document.body.appendChild(modal);

      const negado = document.createElement('div');
      negado.id = 'modal_bucket_lead_denied';
      negado.textContent = 'Lead já foi capturado';
      document.body.appendChild(negado);
    });

    const result = await executeCapture('777', 0, 0);
    expect(result.ok).toBe(false);
    expect(result.motivo).toBe('LEAD_INDISPONIVEL');
    expect(result.retentavel).toBe(false);
    expect(cliquesNoConfirmar).toBe(0);
  });

  it('aborta sem POST se a inspeção ligar antes da confirmação', async () => {
    const card = bucketCard('888');
    let cliquesNoConfirmar = 0;

    card.addEventListener('click', () => {
      const modal = document.createElement('div');
      modal.id = 'modal_bucket_lead';
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      const confirmar = document.createElement('button');
      confirmar.className = 'btn-primary';
      confirmar.addEventListener('click', () => {
        cliquesNoConfirmar += 1;
      });
      footer.appendChild(confirmar);
      modal.appendChild(footer);
      document.body.appendChild(modal);
      // Corretor liga a inspeção enquanto o modal está aberto.
      setCaptureSuspended(true);
    });

    const result = await executeCapture('888', 0, 0);
    expect(result.ok).toBe(false);
    expect(result.motivo).toBe('INSPECAO_ATIVA');
    expect(result.etapa).toBe('confirmacao');
    expect(cliquesNoConfirmar).toBe(0);
  });
});

describe('activityExecutor', () => {
  it('recusa criar atividade sem contrato calibrado', () => {
    const result = executeActivity('123');
    expect(result.ok).toBe(false);
    expect(result.motivo).toBe('CONTRATO_NAO_CALIBRADO');
    expect(result.retentavel).toBe(false);
  });
});
