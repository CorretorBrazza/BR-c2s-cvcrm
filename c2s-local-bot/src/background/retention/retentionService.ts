import { addDays, addMonths, nowIso } from '../../shared/utils/dateUtils';
import { logEvent } from '../events/logEvent';
import { settingsRepository } from '../storage/repositories/settingsRepository';
import { eventLogRepository } from '../storage/repositories/eventLogRepository';
import { leadRepository } from '../storage/repositories/leadRepository';
import { metricsRepository } from '../storage/repositories/metricsRepository';
import { inspectionRepository } from '../storage/repositories/inspectionRepository';

export interface RetentionReport {
  logs: number;
  leads: number;
  meses: number;
  screenshots: number;
  executadoEm: string;
}

class RetentionService {
  async run(): Promise<RetentionReport> {
    const settings = await settingsRepository.get();
    const agora = new Date();

    const logsCutoff = addDays(agora, -settings.retentionTechnicalLogsDays).toISOString();
    const leadsCutoff = addDays(agora, -settings.retentionLeadDataDays).toISOString();
    const monthsCutoff = addMonths(agora, -settings.retentionMetricsMonths).toISOString().slice(0, 7);
    const screenshotCutoff = addDays(agora, -settings.retentionScreenshotsDays).toISOString();

    const logs = await eventLogRepository.deleteOlderThan(logsCutoff);
    const leads = await leadRepository.deleteOlderThan(leadsCutoff);
    const meses = await metricsRepository.deleteOlderThanMonth(monthsCutoff);
    const screenshots = await inspectionRepository.deleteScreenshotsOlderThan(screenshotCutoff);
    await inspectionRepository.deleteScreenshotsBeyond(settings.retentionScreenshotsMaxFiles);

    const report: RetentionReport = { logs, leads, meses, screenshots, executadoEm: nowIso() };
    await logEvent({
      tipoEvento: 'RETENTION_CLEANUP',
      nivel: 'INFO',
      origem: 'SISTEMA',
      resultado: 'limpeza concluída',
      contexto: { ...report },
    });
    return report;
  }
}

export const retentionService = new RetentionService();
