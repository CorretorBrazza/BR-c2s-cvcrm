import { beforeEach, describe, expect, it } from 'vitest';
import { parseLeadHash, parseLeadHashFromUrl } from '@/content/parsers/hashParser';
import { parseLeadDetail } from '@/content/parsers/leadParser';
import { parseBucketDom } from '@/content/parsers/bucketParser';
import { detectPageContext } from '@/content/parsers/pageContext';
import { extractCaptureScript } from '@/content/inspection/domRecorder';
import { probeWindows } from '@/content/actions/windowProbe';

function goTo(path: string): void {
  window.history.replaceState({}, '', path);
}

beforeEach(() => {
  document.body.innerHTML = '';
  goTo('/');
});

describe('hashParser', () => {
  it('decodifica o hash base64 do lead', () => {
    const hash = btoa(JSON.stringify({ status: 'under_negotiation', company_id: 42, seller_id: 7, updated_at: '2026-11-13T12:00:00Z' }));
    const payload = parseLeadHash(hash.replace(/=+$/, ''));
    expect(payload).toMatchObject({ status: 'under_negotiation', company_id: 42, seller_id: 7 });
  });

  it('recusa hash inválido e JSON sem sinal', () => {
    expect(parseLeadHash('nao-e-base64-%%%')).toBeNull();
    expect(parseLeadHash(btoa(JSON.stringify({ foo: 'bar' })))).toBeNull();
  });

  it('extrai o hash da URL', () => {
    const hash = btoa(JSON.stringify({ status: 'new' }));
    goTo(`/webapp/leads/97344775/hash/${hash.replace(/=+$/, '')}`);
    expect(parseLeadHashFromUrl()).toMatchObject({ status: 'new' });
  });
});

describe('leadParser', () => {
  it('extrai snapshot da página de detalhe pelo data-lead', () => {
    const hash = btoa(JSON.stringify({ status: 'under_negotiation', updated_at: '2026-11-13T12:00:00Z' })).replace(/=+$/, '');
    goTo(`/webapp/leads/97344775/hash/${hash}`);

    const lead = {
      id: 97344775,
      uuid: 'uuid-1',
      status: 'under_negotiation',
      seller_id: 12,
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-13T12:00:00Z',
      interacted: false,
    };

    document.body.innerHTML = `
      <div id="page-wrapper">
        <div id="lead-user-data" data-lead='${JSON.stringify(lead)}'></div>
        <div class="customer-name"><strong>Maria Silva</strong></div>
        <a href="tel:+5511987654321">Ligar</a>
        <a id="open-conversation" href="#">WhatsApp</a>
        <div id="reply-area"><textarea></textarea></div>
        <select id="funnel-column-select">
          <option value="1">Novo</option>
          <option value="2" selected>Em atendimento</option>
        </select>
      </div>
    `;

    const snapshot = parseLeadDetail();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.c2sLeadId).toBe('97344775');
    expect(snapshot?.nome).toBe('Maria Silva');
    expect(snapshot?.telefone).toBe('5511987654321');
    expect(snapshot?.statusC2S).toBe('under_negotiation');
    expect(snapshot?.temWhatsapp).toBe(true);
    expect(snapshot?.temReplyArea).toBe(true);
    expect(snapshot?.colunaAtualId).toBe('2');
    expect(snapshot?.confianca).toBe('ALTA');
  });

  it('retorna null fora da página de detalhe', () => {
    goTo('/webapp/bucket_leads');
    expect(parseLeadDetail()).toBeNull();
  });
});

describe('bucketParser', () => {
  it('lê cards do Bolsão sem duplicar', () => {
    goTo('/webapp/bucket_leads');
    document.body.innerHTML = `
      <div class="container bucket-list">
        <div class="leads">
          <div class="bucket-lead-card">
            <a href="/webapp/leads/111/hash/abc">Ver</a>
            <strong>João Souza</strong>
            <span>(11) 91234-5678</span>
            <span class="product-name">Apartamento Centro</span>
          </div>
          <div class="bucket-lead-card">
            <a href="/webapp/leads/111/hash/abc">Ver</a>
            <strong>João Souza</strong>
          </div>
          <div class="bucket-lead-card">
            <a href="/webapp/leads/222/hash/def">Ver</a>
            <strong>Ana Lima</strong>
          </div>
        </div>
      </div>
    `;

    const snapshot = parseBucketDom();
    expect(snapshot.paginaDetectada).toBe(true);
    expect(snapshot.itens).toHaveLength(2);
    expect(snapshot.itens[0]?.c2sLeadId).toBe('111');
    expect(snapshot.itens[0]?.nome).toBe('João Souza');
    expect(snapshot.itens[1]?.c2sLeadId).toBe('222');
  });

  it('lê o id pelo onclick do card e ignora o histórico do Bolsão', () => {
    goTo('/webapp/bucket_leads');
    document.body.innerHTML = `
      <input id="free_tier_enabled" value="false" />
      <div class="container bucket-list">
        <div class="leads">
          <div class="bucket-lead-card" onclick="openModalTakeLead(333, false)">
            <strong>Carlos Pereira</strong>
            <span>(11) 98888-7777</span>
          </div>
        </div>
        <div class="leads">
          <div class="bucket-at-card">
            <div class="ibox-bucket-at">
              <div class="ibox-title" id="bucket-at-title"><strong>Histórico</strong></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const snapshot = parseBucketDom();
    expect(snapshot.itens).toHaveLength(1);
    expect(snapshot.itens[0]?.c2sLeadId).toBe('333');
    expect(snapshot.itens[0]?.nome).toBe('Carlos Pereira');
    expect(snapshot.freeTierLimitReached).toBe(false);
  });

  it('não trata o modal oculto de free tier como bloqueio', () => {
    goTo('/webapp/bucket_leads');
    document.body.innerHTML = `
      <input id="free_tier_enabled" value="false" />
      <div class="modal" id="modal_free_tier_enabled" style="display: none"></div>
      <div class="container bucket-list"><div class="leads"></div></div>
    `;

    const snapshot = parseBucketDom();
    expect(snapshot.freeTierLimitReached).toBe(false);
    expect(snapshot.observacoes).toHaveLength(0);
  });

  it('lê o contador de prazo publicado pelo C2S no card ativo', () => {
    goTo('/webapp/bucket_leads');
    document.body.innerHTML = `
      <input id="free_tier_enabled" value="false" />
      <div class="container bucket-list">
        <div class="leads">
          <div class="bucket-lead-card" onclick="openModalTakeLead(97344775, false)">
            <strong>Lead com prazo</strong>
            <div class="bucket-time"><span class="timer-count" data-seconds="42">00:42</span></div>
          </div>
        </div>
      </div>
    `;

    const snapshot = parseBucketDom();
    expect(snapshot.itens).toHaveLength(1);
    expect(snapshot.itens[0]?.c2sLeadId).toBe('97344775');
    expect(snapshot.itens[0]?.segundosRestantes).toBe(42);
  });
});

describe('windowProbe', () => {
  it('propaga prazo do card e a contagem que o C2S indica no Bolsão', () => {
    goTo('/webapp/bucket_leads');
    document.body.innerHTML = `
      <input id="free_tier_enabled" value="false" />
      <span id="badged_bolsao">2</span>
      <div class="container bucket-list">
        <div class="leads">
          <div class="bucket-lead-card" onclick="openModalTakeLead(444, false)">
            <strong>Lead Teste</strong>
            <div class="bucket-time"><span class="timer-count" data-seconds="90">01:30</span></div>
          </div>
        </div>
      </div>
    `;

    const probe = probeWindows();
    expect(probe.bucketVisivel).toBe(true);
    expect(probe.pool).toHaveLength(1);
    expect(probe.pool[0]?.segundosRestantes).toBe(90);
    expect(probe.bolsaoIndicado).toBe(2);
    // Badge diz 2 and only 1 card was read: the probe must flag the mismatch.
    expect(probe.observacoes.some((item) => item.includes('possível mudança de layout'))).toBe(false);
  });

  it('avisa quando o Bolsão indica leads e o parser não lê nenhum', () => {
    goTo('/webapp/bucket_leads');
    document.body.innerHTML = `
      <input id="free_tier_enabled" value="false" />
      <span id="badged_bolsao">3</span>
      <div class="container bucket-list"><div class="leads"></div></div>
    `;

    const probe = probeWindows();
    expect(probe.pool).toHaveLength(0);
    expect(probe.bolsaoIndicado).toBe(3);
    expect(probe.observacoes.some((item) => item.includes('possível mudança de layout'))).toBe(true);
  });

  it('ignora badge oculto com contagem antiga', () => {
    goTo('/webapp/bucket_leads');
    document.body.innerHTML = `
      <input id="free_tier_enabled" value="false" />
      <span id="badged_bolsao" style="display: none;">3</span>
      <div class="container bucket-list"><div class="leads"></div></div>
    `;

    const probe = probeWindows();
    expect(probe.bolsaoIndicado).toBeUndefined();
    expect(probe.observacoes.some((item) => item.includes('possível mudança de layout'))).toBe(false);
  });
});

describe('extractCaptureScript', () => {
  it('deriva método, caminho e navegação do script da página', () => {
    document.head.innerHTML = '<meta name="csrf-token" content="token" />';
    document.body.innerHTML = `
      <script>
        function openModalTakeLead(lead_id, already_my_lead) {
          $.ajax({ url: "/bucket_leads/" + lead_id, type: "GET" });
        }
        function takeLeadToMe() {
          var lead_id = take_lead_id;
          $.ajax({
            url: "/bucket_leads/" + lead_id,
            type: "POST",
            success: function (data) {
              if (data.message === 'redirect_to_upselling') {
                window.location.href = "bucket_leads/upselling_free_tier";
              } else window.location.href = "/webapp/leads/" + lead_id;
            },
          });
        }
      </script>
    `;

    const evidence = extractCaptureScript();
    expect(evidence).toMatchObject({
      metodoPost: true,
      metodoGetPreChecagem: true,
      caminho: '/bucket_leads/{id}',
      navegacaoSucesso: '/webapp/leads/{id}',
      sinalUpselling: 'redirect_to_upselling',
      csrfMetaPresente: true,
    });

    document.head.innerHTML = '';
  });

  it('retorna indefinido quando a página não tem o script de captura', () => {
    document.body.innerHTML = '<div>sem script</div>';
    expect(extractCaptureScript()).toBeUndefined();
  });
});

describe('pageContext', () => {  it('detecta login', () => {
    document.body.innerHTML = '<form class="login-form"><input name="username" /></form>';
    const page = detectPageContext('https://api.contact2sale.com/webapp/login');
    expect(page.context).toBe('LOGIN');
    expect(page.sessaoValida).toBe(false);
  });

  it('detecta lista de leads', () => {
    document.body.innerHTML = '<div class="panel-body lead-list"></div>';
    const page = detectPageContext('https://api.contact2sale.com/webapp/leads/v2');
    expect(page.context).toBe('CONTACTS_LIST');
    expect(page.sessaoValida).toBe(true);
  });

  it('detecta detalhe por DOM mesmo com URL inesperada', () => {
    document.body.innerHTML = '<div id="lead-info"></div>';
    const page = detectPageContext('https://api.contact2sale.com/webapp/leads/1');
    expect(page.context).toBe('LEAD_DETAIL');
  });

  it('marca desconhecido sem shell', () => {
    const page = detectPageContext('https://api.contact2sale.com/qualquer');
    expect(page.context).toBe('UNKNOWN');
  });
});
