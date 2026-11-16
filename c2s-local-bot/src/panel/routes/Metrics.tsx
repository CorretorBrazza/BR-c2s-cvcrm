import type { DailyMetrics, MonthlyMetrics } from '../../shared/types/metrics';
import { formatDuration } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { downloadText } from '../lib/panelApi';
import { Card, CardBody, EmptyState, ErrorBox, SectionTitle, Stat } from '../components/Ui';

export function Metrics(): JSX.Element {
  const metrics = usePanelQuery<{ hoje: DailyMetrics; mes: MonthlyMetrics; janela7Dias: DailyMetrics[] }>(
    { type: 'metrics' },
    { autoRefreshMs: 30_000 },
  );

  const hoje = metrics.data?.hoje;
  const mes = metrics.data?.mes;
  const ultimos = metrics.data?.janela7Dias ?? [];
  const maximo = Math.max(1, ...ultimos.map((day) => day.leadsDetectados));

  const exportCsv = (): void => {
    const header = 'data;detectados;bolsao;diretos;capturados;perdidos;mensagens;falhas;tempoMedioMs';
    const lines = ultimos.map((day) =>
      [
        day.data,
        day.leadsDetectados,
        day.leadsBolsao,
        day.leadsDiretos,
        day.leadsCapturados,
        day.leadsPerdidos,
        day.mensagensEnviadas,
        day.falhas,
        day.tempoMedioCapturaMs,
      ].join(';'),
    );
    downloadText(`c2s-metricas-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...lines].join('\n'), 'text/csv');
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Métricas"
        description="Contadores agregados por dia e por mês. Base para acompanhar perdas e tempo de captura."
        actions={
          <button type="button" className="btn-secondary" onClick={exportCsv} disabled={ultimos.length === 0}>
            Exportar CSV
          </button>
        }
      />

      {metrics.error ? <ErrorBox message={metrics.error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Detectados (mês)" value={mes?.leadsDetectados ?? 0} />
        <Stat label="Capturados (mês)" value={mes?.leadsCapturados ?? 0} tone="good" />
        <Stat label="Perdidos (mês)" value={mes?.leadsPerdidos ?? 0} tone={(mes?.leadsPerdidos ?? 0) > 0 ? 'bad' : 'default'} />
        <Stat label="Taxa de captura" value={`${(((mes?.taxaCaptura ?? 0) * 100) | 0)}%`} hint="capturados / detectados" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Hoje</h3>
            {hoje ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Item label="Detectados" value={hoje.leadsDetectados} />
                <Item label="Bolsão" value={hoje.leadsBolsao} />
                <Item label="Diretos" value={hoje.leadsDiretos} />
                <Item label="Capturados" value={hoje.leadsCapturados} />
                <Item label="Em atendimento" value={hoje.leadsEmAtendimento} />
                <Item label="Mensagens" value={hoje.mensagensEnviadas} />
                <Item label="Falhas" value={hoje.falhas} />
                <Item label="Tempo médio" value={formatDuration(hoje.tempoMedioCapturaMs)} />
              </dl>
            ) : (
              <EmptyState title="Sem dados de hoje" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Detectados nos últimos 7 dias</h3>
            {ultimos.length === 0 ? (
              <EmptyState title="Sem histórico" description="As métricas começam a ser gravadas com o uso do robô." />
            ) : (
              <div className="space-y-2">
                {ultimos.map((day) => (
                  <div key={day.data} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 font-mono text-xs text-slate-500">{day.data.slice(5)}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                      <div
                        className="h-full rounded bg-brand-500"
                        style={{ width: `${Math.round((day.leadsDetectados / maximo) * 100)}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs font-semibold text-slate-700">
                      {day.leadsDetectados}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Últimos 7 dias (detalhado)</h3>
          {ultimos.length === 0 ? (
            <EmptyState title="Sem dados" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Data</th>
                    <th className="th">Detectados</th>
                    <th className="th">Bolsão</th>
                    <th className="th">Diretos</th>
                    <th className="th">Capturados</th>
                    <th className="th">Perdidos</th>
                    <th className="th">Falhas</th>
                    <th className="th">Tempo médio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...ultimos].reverse().map((day) => (
                    <tr key={day.data}>
                      <td className="td font-mono text-xs">{day.data}</td>
                      <td className="td">{day.leadsDetectados}</td>
                      <td className="td">{day.leadsBolsao}</td>
                      <td className="td">{day.leadsDiretos}</td>
                      <td className="td text-emerald-700">{day.leadsCapturados}</td>
                      <td className="td text-red-600">{day.leadsPerdidos}</td>
                      <td className="td">{day.falhas}</td>
                      <td className="td">{formatDuration(day.tempoMedioCapturaMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Item({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
