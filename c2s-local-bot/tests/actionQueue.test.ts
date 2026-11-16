import { describe, expect, it } from 'vitest';
import { ActionQueue, backoffMs, memoryQueueStorage } from '@/background/queue/actionQueue';

describe('ActionQueue (outbox transacional)', () => {
  it('enfileira e devolve por prioridade', async () => {
    const queue = new ActionQueue(memoryQueueStorage());
    await queue.enqueue({ tipo: 'DETECTAR_LEAD', prioridade: 1 });
    const urgente = await queue.enqueue({ tipo: 'CAPTURAR_BOLSAO', prioridade: 9, c2sLeadId: '123' });

    const next = await queue.peek();
    expect(next?.actionId).toBe(urgente.actionId);
    expect(next?.c2sLeadId).toBe('123');
    expect(await queue.size()).toBe(2);
  });

  it('remove item concluído', async () => {
    const queue = new ActionQueue(memoryQueueStorage());
    const entry = await queue.enqueue({ tipo: 'VALIDAR_SESSAO' });
    await queue.remove(entry.actionId);
    expect(await queue.size()).toBe(0);
  });

  it('aplica backoff e esconde item até a hora', async () => {
    const queue = new ActionQueue(memoryQueueStorage());
    const entry = await queue.enqueue({ tipo: 'MOVER_FUNIL', maxTentativas: 3 });
    const result = await queue.fail(entry.actionId, 'timeout');
    expect(result).toBe('retry');

    const [stored] = await queue.list();
    expect(stored?.tentativas).toBe(1);
    expect(stored?.proximaTentativaEm).toBeDefined();
    expect(new Date(stored?.proximaTentativaEm ?? 0).getTime()).toBeGreaterThan(Date.now());
    expect(await queue.peek()).toBeUndefined();
  });

  it('descarta quando não é retentável ou estoura tentativas', async () => {
    const queue = new ActionQueue(memoryQueueStorage());
    const entry = await queue.enqueue({ tipo: 'ENVIAR_MENSAGEM', maxTentativas: 2 });

    expect(await queue.fail(entry.actionId, '400', false)).toBe('dead');
    expect(await queue.size()).toBe(0);

    const outro = await queue.enqueue({ tipo: 'ENVIAR_MENSAGEM', maxTentativas: 1 });
    expect(await queue.fail(outro.actionId, 'falha', true)).toBe('dead');
    expect(await queue.size()).toBe(0);
  });

  it('calcula backoff exponencial limitado', () => {
    expect(backoffMs(0)).toBe(1_000);
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(50)).toBeLessThanOrEqual(30_000);
  });

  it('limpa a fila', async () => {
    const queue = new ActionQueue(memoryQueueStorage());
    await queue.enqueue({ tipo: 'DETECTAR_LEAD' });
    await queue.clear();
    expect(await queue.size()).toBe(0);
  });
});
