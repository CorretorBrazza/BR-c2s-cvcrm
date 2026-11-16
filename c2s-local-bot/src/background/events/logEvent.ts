import type { NewEventLog } from '../../shared/types/eventLog';
import { eventLogRepository } from '../storage/repositories/eventLogRepository';
import { eventBus } from './eventBus';

/**
 * Ponto único de log. Qualquer falha de persistência é engolida de propósito:
 * log não pode quebrar a operação principal.
 */
export async function logEvent(event: NewEventLog): Promise<void> {
  try {
    const record = await eventLogRepository.add(event);
    await eventBus.publish(record);
  } catch (error) {
    console.warn('[c2s] falha ao registrar evento', error);
  }
}
