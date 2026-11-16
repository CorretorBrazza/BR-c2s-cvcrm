import { describe, expect, it } from 'vitest';
import {
  isSuperReplyUrl,
  leadIdFromReplyBody,
  replyResponseSucceeded,
} from '@/shared/analysis/interactionDetector';

describe('interactionDetector: identificação do endpoint', () => {
  it('reconhece apenas POST de super_reply', () => {
    expect(isSuperReplyUrl('https://api.contact2sale.com/webapp/leads/super_reply')).toBe(true);
    expect(isSuperReplyUrl('/webapp/leads/super_reply')).toBe(true);
    expect(isSuperReplyUrl('https://api.contact2sale.com/webapp/leads/super_reply/')).toBe(true);
    expect(isSuperReplyUrl('https://api.contact2sale.com/webapp/leads/status_update')).toBe(false);
    expect(isSuperReplyUrl('https://api.contact2sale.com/webapp/leads/super_reply_extra')).toBe(false);
  });
});

describe('interactionDetector: id do lead no corpo', () => {
  it('lê FormData serializado como a página envia', () => {
    expect(leadIdFromReplyBody('id=97893493&body=Oi%2C+tudo+bem%3F')).toBe('97893493');
  });

  it('aceita JSON e o campo alternativo lead_id', () => {
    expect(leadIdFromReplyBody('{"id":123,"body":"x"}')).toBe('123');
    expect(leadIdFromReplyBody('{"lead_id":"456"}')).toBe('456');
    expect(leadIdFromReplyBody('lead_id=789')).toBe('789');
  });

  it('rejeita corpo vazio, inválido ou sem id numérico', () => {
    expect(leadIdFromReplyBody('')).toBeNull();
    expect(leadIdFromReplyBody(null)).toBeNull();
    expect(leadIdFromReplyBody('body=sem+id')).toBeNull();
    expect(leadIdFromReplyBody('{"id":"abc"}')).toBeNull();
    expect(leadIdFromReplyBody('{"id":{"$ne":1}}')).toBeNull();
    expect(leadIdFromReplyBody('id=123456789012345678901234')).toBeNull();
  });

  it('nunca devolve o texto da mensagem', () => {
    const parsed = leadIdFromReplyBody('id=1&body=segredo-do-cliente');
    expect(parsed).toBe('1');
    expect(JSON.stringify(parsed)).not.toContain('segredo');
  });
});

describe('interactionDetector: sucesso da resposta', () => {
  it('exige 2xx', () => {
    expect(replyResponseSucceeded(200, '{"success":true}')).toBe(true);
    expect(replyResponseSucceeded(204, '')).toBe(true);
    expect(replyResponseSucceeded(500, '{"success":true}')).toBe(false);
    expect(replyResponseSucceeded(undefined, '{"success":true}')).toBe(false);
    expect(replyResponseSucceeded(302, '')).toBe(false);
  });

  it('respeita success:false mesmo com 2xx', () => {
    expect(replyResponseSucceeded(200, '{"success":false}')).toBe(false);
    expect(replyResponseSucceeded(200, '{"success":true}')).toBe(true);
  });

  it('2xx sem corpo ou com corpo não-JSON conta como enviado', () => {
    expect(replyResponseSucceeded(200, null)).toBe(true);
    expect(replyResponseSucceeded(200, 'ok')).toBe(true);
  });
});
