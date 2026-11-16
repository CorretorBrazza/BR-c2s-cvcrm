import { describe, expect, it } from 'vitest';
import { computeCalibrationCounts } from '@/shared/analysis/calibrationCounts';
import type { DomSample, NetworkSample, SelectorProfile } from '@/shared/types/inspection';

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

function dom(context: DomSample['context']): DomSample {
  seq++;
  return {
    id: `dom_${seq}`,
    timestamp: new Date(2026, 0, 1, 0, 1, seq).toISOString(),
    context,
    url: 'https://api.contact2sale.com/webapp/bucket_leads',
    html: '<html></html>',
    truncated: false,
    piiIncluded: false,
  };
}

function profile(): SelectorProfile {
  seq++;
  return {
    id: `sel_${seq}`,
    timestamp: new Date(2026, 0, 1, 0, 2, seq).toISOString(),
    context: 'BUCKET',
    url: 'https://api.contact2sale.com/webapp/bucket_leads',
    candidates: [],
    faltando: [],
  };
}

describe('computeCalibrationCounts', () => {
  it('não confunde POST de captura com resposta da lista do Bolsão', () => {
    const counts = computeCalibrationCounts({
      network: [
        net({
          url: 'https://api.contact2sale.com/bucket_leads/123',
          method: 'POST',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          responseBody: '{"message":"ok"}',
        }),
      ],
      dom: [],
      selectors: [],
    });

    expect(counts.bucketListResponse).toBe(0);
    expect(counts.capturePost).toBe(1);
  });

  it('só conta lista com status 2xx e corpo', () => {
    const counts = computeCalibrationCounts({
      network: [
        net({
          url: 'https://api.contact2sale.com/webapp/bucket_leads?page=1',
          method: 'GET',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          responseBody: '{"bucket_leads":[]}',
        }),
        net({
          url: 'https://api.contact2sale.com/webapp/bucket_leads',
          method: 'GET',
          endpointType: 'BUCKET_LEADS',
          status: 302,
          responseBody: '',
        }),
        net({
          url: 'https://api.contact2sale.com/webapp/leads/v2',
          method: 'GET',
          endpointType: 'LEADS_V2',
          status: 200,
          responseBody: '{"leads":[]}',
        }),
      ],
      dom: [],
      selectors: [],
    });

    expect(counts.bucketListResponse).toBe(1);
    expect(counts.leadsV2Response).toBe(1);
  });

  it('conta GET e POST de captura e ignora caminhos parecidos', () => {
    const counts = computeCalibrationCounts({
      network: [
        net({
          url: 'https://api.contact2sale.com/bucket_leads/123',
          method: 'GET',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          responseBody: '{}',
        }),
        net({
          url: 'https://api.contact2sale.com/bucket_leads/123/extra',
          method: 'POST',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          responseBody: '{}',
        }),
        net({
          url: 'https://api.contact2sale.com/bucket_leads/456',
          method: 'POST',
          endpointType: 'BUCKET_LEADS',
          status: 200,
          responseBody: '{}',
        }),
      ],
      dom: [],
      selectors: [],
    });

    expect(counts.captureGet).toBe(1);
    expect(counts.capturePost).toBe(1);
  });

  it('usa DOM como evidência de visita às páginas', () => {
    const counts = computeCalibrationCounts({
      network: [],
      dom: [dom('BUCKET'), dom('LEAD_DETAIL'), dom('CONTACTS_LIST')],
      selectors: [profile()],
    });

    expect(counts.bucketPage).toBe(1);
    expect(counts.leadDetailPage).toBe(1);
    expect(counts.contactsListPage).toBe(1);
    expect(counts.domSamples).toBe(3);
    expect(counts.selectorProfiles).toBe(1);
  });
});
