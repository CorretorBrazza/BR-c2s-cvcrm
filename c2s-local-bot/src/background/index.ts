import { APP_VERSION } from '../shared/constants/defaults';
import { logEvent } from './events/logEvent';
import { inspectionService } from './inspection/inspectionService';
import { licenseService } from './license/licenseService';
import { sessionService } from './session/sessionService';
import { settingsRepository } from './storage/repositories/settingsRepository';
import { templateRepository } from './storage/repositories/templateRepository';

let initialized: Promise<void> | null = null;

/**
 * Inicialização idempotente. O service worker MV3 pode ser encerrado a
 * qualquer momento, então tudo roda de novo sem duplicar dados.
 */
export function initBackground(): Promise<void> {
  if (initialized) return initialized;

  initialized = (async () => {
    await settingsRepository.ensureDefaults();
    await templateRepository.ensureDefaults();
    await sessionService.hydrate();
    await licenseService.hydrate();
    await inspectionService.hydrate();

    const settings = await settingsRepository.get();
    inspectionService.applySettings(settings);
    if (settings.licenseKey) {
      await licenseService.refresh(settings);
    }

    await logEvent({
      tipoEvento: 'EXTENSION_STARTED',
      nivel: 'INFO',
      origem: 'SISTEMA',
      resultado: 'ok',
      contexto: { versao: APP_VERSION, inspecao: settings.inspectMode },
    });
  })().catch((error) => {
    initialized = null;
    throw error;
  });

  return initialized;
}
