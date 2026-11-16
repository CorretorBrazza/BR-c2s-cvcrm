import type { BotStatus, DailyMetrics, MetricsSnapshot, MonthlyMetrics } from '../../shared/types/metrics';
import { dayKey } from '../../shared/utils/dateUtils';
import { metricsRepository } from '../storage/repositories/metricsRepository';

class MetricsService {
  async increment(
    counter: Parameters<typeof metricsRepository.increment>[0],
    by = 1,
    captureMs?: number,
  ): Promise<void> {
    await metricsRepository.increment(counter, by, captureMs !== undefined ? { captureMs } : {});
  }

  async snapshot(status: BotStatus = 'MONITORANDO'): Promise<MetricsSnapshot & { janela30Dias: DailyMetrics[] }> {
    const hoje = await metricsRepository.getDaily(dayKey());
    const mes = await metricsRepository.getMonthly();
    const janela7Dias = await metricsRepository.lastDays(7);
    const janela30Dias = await metricsRepository.lastDays(30);
    return {
      hoje,
      mes,
      janela7Dias,
      janela30Dias,
      status,
      atualizadoEm: new Date().toISOString(),
    };
  }

  async daily(desde: string, ate: string): Promise<DailyMetrics[]> {
    return metricsRepository.dailyWindow(desde, ate);
  }

  /** Métricas agregadas em CSV — apenas dados locais, sem PII. */
  async exportCsv(): Promise<string> {
    const rows = await metricsRepository.lastDays(90);
    const header = [
      'data',
      'leadsDetectados',
      'leadsBolsao',
      'leadsDiretos',
      'leadsCapturados',
      'leadsPerdidos',
      'leadsEmAtendimento',
      'mensagensEnviadas',
      'falhas',
      'tempoMedioCapturaMs',
      'taxaCaptura',
    ].join(',');
    const lines = rows.map((row) =>
      [
        row.data,
        row.leadsDetectados,
        row.leadsBolsao,
        row.leadsDiretos,
        row.leadsCapturados,
        row.leadsPerdidos,
        row.leadsEmAtendimento,
        row.mensagensEnviadas,
        row.falhas,
        row.tempoMedioCapturaMs,
        row.taxaCaptura.toFixed(4),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  emptyMonth(): MonthlyMetrics {
    return {
      anoMes: dayKey().slice(0, 7),
      leadsDetectados: 0,
      leadsBolsao: 0,
      leadsDiretos: 0,
      leadsCapturados: 0,
      leadsPerdidos: 0,
      leadsEmAtendimento: 0,
      mensagensEnviadas: 0,
      falhas: 0,
      tempoMedioCapturaMs: 0,
      taxaCaptura: 0,
      atualizadoEm: new Date().toISOString(),
    };
  }
}

export const metricsService = new MetricsService();
