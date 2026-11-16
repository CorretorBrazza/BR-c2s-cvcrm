import { describe, expect, it } from 'vitest';
import { analyzeCalibrationContract } from '@/shared/analysis/contractAnalyzer';
import type { DomSample, NetworkSample, SelectorCandidate, SelectorProfile } from '@/shared/types/inspection';

let seq = 0;

function net(partial: Partial<NetworkSample> & Pick<NetworkSample, 'url' | 'method'>): NetworkSample {
  seq++;
  return {
    id: `net_${seq}`,
    correlationId: `corr_${seq}`,
    timestamp: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    endpointType: 'DESCONHECIDO',
    untrusted: true,
    ...partial,
  };
}

function dom(context: DomSample['context'], html: string): DomSample {
  seq++;
  return {
    id: `dom_${seq}`,
    timestamp: new Date(2026, 0, 1, 0, 1, seq).toISOString(),
    context,
    url: 'https://api.contact2sale.com/webapp/bucket_leads',
    html,
    truncated: false,
    piiIncluded: false,
  };
}

function candidate(concept: string, selector: string, matches: number, visiveis: number): SelectorCandidate {
  return { concept, selector, matches, visiveis, score: matches * 10 + visiveis * 25 };
}

function profile(candidates: SelectorCandidate[]): SelectorProfile {
  seq++;
  return {
    id: `sel_${seq}`,
    timestamp: new Date(2026, 0, 1, 0, 2, seq).toISOString(),
    context: 'BUCKET',
    url: 'https://api.contact2sale.com/webapp/bucket_leads',
    candidates,
    faltando: [],
  };
}

describe('analyzeCalibrationContract', () => {
  it('infere a lista do Bolsão a partir da resposta JSON', () => {
    const contract = analyzeCalibrationContract({
      network: [
        net({
          url: 'https://api.contact2sale.com/webapp/bucket_leads?page=1',
          method: 'GET',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          responseBody: JSON.stringify({
            bucket_leads: [
              { id: 1, name: 'Maria', phone: '11999998888', real_estate: 'Apartamento' },
              { id: 2, name: 'João', phone: '11888887777', real_estate: 'Casa' },
            ],
          }),
        }),
      ],
      dom: [],
      selectors: [],
    });

    expect(contract.bucketList).toMatchObject({
      metodo: 'GET',
      caminho: '/webapp/bucket_leads',
      formato: 'JSON',
      caminhoItens: 'bucket_leads',
      origem: 'REDE',
      confianca: 'ALTA',
    });
    expect(contract.bucketList?.chavesItem).toEqual(
      expect.arrayContaining(['id', 'name', 'phone', 'real_estate']),
    );
  });

  it('infere o contrato de captura sem copiar texto livre da resposta', () => {
    const contract = analyzeCalibrationContract({
      network: [
        net({
          url: 'https://api.contact2sale.com/bucket_leads/97344775',
          method: 'GET',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          responseBody: '{}',
        }),
        net({
          url: 'https://api.contact2sale.com/bucket_leads/97344775',
          method: 'POST',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          requestHeaders: { 'x-csrf-token': '[REDACTED]', 'content-type': 'application/x-www-form-urlencoded' },
          requestBody: 'authenticity_token=abc&lead_id=97344775',
          responseBody: '{"message":"redirect_to_upselling","phone":"11999998888"}',
        }),
      ],
      dom: [],
      selectors: [],
    });

    expect(contract.capture).toMatchObject({
      caminho: '/bucket_leads/{id}',
      getObservado: true,
      postObservado: true,
      postConfirmado: true,
      origem: 'REDE',
      formatoPayload: 'FORM',
      confianca: 'ALTA',
    });
    expect(contract.capture?.chavesPayload).toEqual(['authenticity_token', 'lead_id']);
    expect(contract.capture?.headersCsrf).toContain('x-csrf-token');
    expect(contract.capture?.sinaisFalha).toContain('redirect_to_upselling');
    expect(JSON.stringify(contract)).not.toContain('11999998888');
  });

  it('detecta o gate de interação no DOM e nos seletores', () => {
    const contract = analyzeCalibrationContract({
      network: [],
      dom: [
        dom(
          'BUCKET',
          '<div id="modal_bucket_lead_not_interacted" class="modal"></div><input id="free_tier_enabled" value="true" />',
        ),
      ],
      selectors: [profile([candidate('bucketNotInteractedModal', '#modal_bucket_lead_not_interacted', 1, 0)])],
    });

    expect(contract.gate.modalObservado).toBe(true);
    expect(contract.gate.freeTierBloqueado).toBe(true);
    expect(contract.gate.freeTierValor).toBe('true');
    expect(contract.gate.modalSelectors).toContain('#modal_bucket_lead_not_interacted');
    expect(contract.gate.confianca).toBe('ALTA');
    expect(contract.pendencias.join(' ')).toContain('Gate client-side observado');
  });

  it('não marca free tier quando o input está "false" ou o modal está oculto', () => {
    const contract = analyzeCalibrationContract({
      network: [],
      dom: [dom('BUCKET', '<input id="free_tier_enabled" value="false" />')],
      selectors: [
        profile([
          candidate('bucketFreeTierModal', '#modal_free_tier_enabled', 1, 0),
          candidate('bucketLimitReached', '.upgrade_bucket.free_tier_limit_reached', 0, 0),
        ]),
      ],
    });

    expect(contract.gate.freeTierValor).toBe('false');
    expect(contract.gate.freeTierBloqueado).toBe(false);
  });

  it('deriva a lista do Bolsão do DOM quando não há resposta de rede', () => {
    const contract = analyzeCalibrationContract({
      network: [],
      dom: [
        dom(
          'BUCKET',
          `<div class="container bucket-list">
             <div class="leads">
               <div class="bucket-lead-card" onclick="openModalTakeLead(111, false)">A</div>
               <div class="bucket-lead-card" onclick="openModalTakeLead(222, false)">B</div>
             </div>
             <div class="leads"><div class="bucket-at-card">histórico</div></div>
           </div>`,
        ),
      ],
      selectors: [],
    });

    expect(contract.bucketList).toMatchObject({
      metodo: 'GET',
      caminho: '/webapp/bucket_leads',
      origem: 'DOM',
      totalNoPool: 2,
      confianca: 'MEDIA',
    });
    expect(contract.bucketList?.cardClasses).toContain('bucket-lead-card');
    // Histórico não conta como pool ativo.
    expect(contract.bucketList?.totalNoPool).toBe(2);
  });

  it('deriva o POST do script da página e mantém "a confirmar"', () => {
    const contract = analyzeCalibrationContract({
      network: [],
      dom: [
        {
          ...dom('BUCKET', '<div class="container bucket-list"></div>'),
          captureScript: {
            metodoPost: true,
            metodoGetPreChecagem: true,
            caminho: '/bucket_leads/{id}',
            navegacaoSucesso: '/webapp/leads/{id}',
            sinalUpselling: 'redirect_to_upselling',
            csrfMetaPresente: true,
          },
        },
      ],
      selectors: [],
    });

    expect(contract.capture).toMatchObject({
      caminho: '/bucket_leads/{id}',
      getObservado: true,
      postObservado: false,
      postConfirmado: false,
      origem: 'SCRIPT',
      formatoPayload: 'VAZIO',
      confianca: 'MEDIA',
    });
    expect(contract.capture?.sinaisSucesso).toContain('navegacao_para_webapp_leads');
    expect(contract.capture?.sinaisFalha).toContain('redirect_to_upselling');
    expect(contract.pendencias.join(' ')).toContain('a confirmar na primeira captura real');
    expect(contract.pendencias.join(' ')).toContain('csrf-token');
  });

  it('lista pendências quando não há amostras', () => {
    const contract = analyzeCalibrationContract({ network: [], dom: [], selectors: [] });

    expect(contract.bucketList).toBeNull();
    expect(contract.capture).toBeNull();
    expect(contract.gate.confianca).toBe('AUSENTE');
    expect(contract.gate.freeTierValor).toBe('ausente');
    expect(contract.pendencias.length).toBeGreaterThanOrEqual(4);
    expect(contract.seletores.faltando.length).toBeGreaterThan(0);
  });

  it('normaliza IDs diferentes de captura para o mesmo template', () => {
    const contract = analyzeCalibrationContract({
      network: [
        net({ url: 'https://api.contact2sale.com/bucket_leads/1', method: 'POST', status: 200 }),
        net({ url: 'https://api.contact2sale.com/bucket_leads/2', method: 'POST', status: 200 }),
      ],
      dom: [],
      selectors: [],
    });

    expect(contract.conflitos).toHaveLength(0);
    expect(contract.capture?.caminho).toBe('/bucket_leads/{id}');
  });
});
