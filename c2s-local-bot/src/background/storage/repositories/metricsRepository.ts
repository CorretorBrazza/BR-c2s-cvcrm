import type { DailyMetrics, MonthlyMetrics } from '../../../shared/types/metrics';
import { dayKey, monthKey, nowIso } from '../../../shared/utils/dateUtils';
import { dbDelete, dbGet, dbGetAll, dbPut } from '../indexedDb';

export function emptyDaily(data: string): DailyMetrics {
  return {
    data,
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
    atualizadoEm: nowIso(),
  };
}

export function emptyMonthly(anoMes: string): MonthlyMetrics {
  return {
    anoMes,
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
    atualizadoEm: nowIso(),
  };
}

export type DailyCounter =
  | 'leadsDetectados'
  | 'leadsBolsao'
  | 'leadsDiretos'
  | 'leadsCapturados'
  | 'leadsPerdidos'
  | 'leadsEmAtendimento'
  | 'mensagensEnviadas'
  | 'falhas';

type NumericDailyKey = Exclude<keyof DailyMetrics, 'data' | 'atualizadoEm' | 'taxaCaptura'>;

/** Média incremental correta (evita recalcular em cima da média). */
function applyAverage(current: number, count: number, sample: number): number {
  if (sample <= 0) return current;
  if (count <= 0) return sample;
  return Math.round((current * count + sample) / (count + 1));
}

function recalcRate(daily: DailyMetrics): void {
  daily.taxaCaptura =
    daily.leadsDetectados > 0 ? daily.leadsCapturados / daily.leadsDetectados : 0;
  daily.atualizadoEm = nowIso();
}

function mergeIntoMonthly(monthly: MonthlyMetrics, daily: DailyMetrics): void {
  monthly.leadsDetectados += daily.leadsDetectados;
  monthly.leadsBolsao += daily.leadsBolsao;
  monthly.leadsDiretos += daily.leadsDiretos;
  monthly.leadsCapturados += daily.leadsCapturados;
  monthly.leadsPerdidos += daily.leadsPerdidos;
  monthly.leadsEmAtendimento += daily.leadsEmAtendimento;
  monthly.mensagensEnviadas += daily.mensagensEnviadas;
  monthly.falhas += daily.falhas;

  if (daily.tempoMedioCapturaMs > 0) {
    monthly.tempoMedioCapturaMs = applyAverage(
      monthly.tempoMedioCapturaMs,
      Math.max(1, daily.leadsCapturados - 1),
      daily.tempoMedioCapturaMs,
    );
  }

  monthly.taxaCaptura =
    monthly.leadsDetectados > 0 ? monthly.leadsCapturados / monthly.leadsDetectados : 0;
  monthly.atualizadoEm = nowIso();

  if (!monthly.melhorDia || daily.leadsCapturados > 0) {
    const best = monthly.melhorDia;
    if (!best) monthly.melhorDia = daily.data;
  }
  if (daily.leadsPerdidos > 0 && !monthly.piorDiaPerdas) {
    monthly.piorDiaPerdas = daily.data;
  }
}

export class MetricsRepository {
  /**
   * Incremento atômico (do ponto de vista do SW, que é single-thread).
   * Retorna os dois registros atualizados.
   */
  async increment(
    counter: DailyCounter,
    by = 1,
    options: { captureMs?: number; at?: Date } = {},
  ): Promise<{ daily: DailyMetrics; monthly: MonthlyMetrics }> {
    const at = options.at ?? new Date();
    const data = dayKey(at);
    const anoMes = monthKey(at);

    const daily = (await dbGet<DailyMetrics>('daily_metrics', data)) ?? emptyDaily(data);
    const before = daily[counter as NumericDailyKey] ?? 0;
    (daily as unknown as Record<string, number>)[counter as NumericDailyKey] = before + by;

    if (counter === 'leadsCapturados' && options.captureMs !== undefined) {
      const captures = Math.max(1, daily.leadsCapturados);
      daily.tempoMedioCapturaMs = applyAverage(
        daily.tempoMedioCapturaMs,
        captures - 1,
        options.captureMs,
      );
    }

    recalcRate(daily);
    await dbPut('daily_metrics', daily);

    // Reconstrói o mês a partir dos dias conhecidos: evita drift por incremento duplo.
    const days = await this.dailyWindow(`${anoMes}-01`, `${anoMes}-31`);
    const rebuilt = emptyMonthly(anoMes);
    for (const row of days) mergeIntoMonthly(rebuilt, row);
    rebuilt.melhorDia = days
      .filter((row) => row.leadsCapturados > 0)
      .sort((a, b) => b.leadsCapturados - a.leadsCapturados)[0]?.data;
    rebuilt.piorDiaPerdas = days
      .filter((row) => row.leadsPerdidos > 0)
      .sort((a, b) => b.leadsPerdidos - a.leadsPerdidos)[0]?.data;

    await dbPut('monthly_metrics', rebuilt);
    return { daily, monthly: rebuilt };
  }

  async getDaily(data = dayKey()): Promise<DailyMetrics> {
    return (await dbGet<DailyMetrics>('daily_metrics', data)) ?? emptyDaily(data);
  }

  async getMonthly(anoMes = monthKey()): Promise<MonthlyMetrics> {
    return (await dbGet<MonthlyMetrics>('monthly_metrics', anoMes)) ?? emptyMonthly(anoMes);
  }

  async dailyWindow(desde: string, ate: string): Promise<DailyMetrics[]> {
    const rows = await dbGetAll<DailyMetrics>('daily_metrics');
    return rows
      .filter((row) => row.data >= desde && row.data <= ate)
      .sort((a, b) => (a.data < b.data ? -1 : 1));
  }

  async lastDays(days = 7, today = dayKey()): Promise<DailyMetrics[]> {
    const rows = await dbGetAll<DailyMetrics>('daily_metrics');
    return rows
      .filter((row) => row.data <= today)
      .sort((a, b) => (a.data < b.data ? 1 : -1))
      .slice(0, Math.max(1, days))
      .reverse();
  }

  async deleteOlderThanMonth(anoMesCutoff: string): Promise<number> {
    const monthly = await dbGetAll<MonthlyMetrics>('monthly_metrics');
    let deleted = 0;
    for (const row of monthly) {
      if (row.anoMes < anoMesCutoff) {
        await dbDelete('monthly_metrics', row.anoMes);
        deleted++;
      }
    }
    const daily = await dbGetAll<DailyMetrics>('daily_metrics');
    for (const row of daily) {
      if (row.data.slice(0, 7) < anoMesCutoff) {
        await dbDelete('daily_metrics', row.data);
      }
    }
    return deleted;
  }
}

export const metricsRepository = new MetricsRepository();
