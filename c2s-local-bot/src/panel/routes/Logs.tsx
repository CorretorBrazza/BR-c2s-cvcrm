import { useState } from 'react';
import type { EventLogRecord } from '../../shared/types/eventLog';
import { formatDateTimeBr } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { downloadJson } from '../lib/panelApi';
import { Badge, Card, CardBody, EmptyState, ErrorBox, Modal, SectionTitle, Spinner } from '../components/Ui';

const NIVEIS = ['', 'INFO', 'AVISO', 'ERRO'] as const;

function levelTone(nivel: string): 'slate' | 'amber' | 'red' | 'blue' {
  if (nivel === 'ERRO') return 'red';
  if (nivel === 'AVISO') return 'amber';
  if (nivel === 'INFO') return 'blue';
  return 'slate';
}

export function Logs(): JSX.Element {
  const [nivel, setNivel] = useState('');
  const [busca, setBusca] = useState('');
  const [selected, setSelected] = useState<EventLogRecord | null>(null);
  const logs = usePanelQuery<EventLogRecord[]>({
    type: 'logs',
    limit: 300,
    filters: { ...(nivel ? { nivel } : {}), ...(busca ? { busca } : {}) },
  });

  const rows = logs.data ?? [];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Logs técnicos"
        description="Eventos registrados localmente. Payloads e respostas são resumidos e mascarados; nada sai do navegador."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={logs.refresh} disabled={logs.loading}>
              Atualizar
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => downloadJson(`c2s-logs-${Date.now()}.json`, rows)}
              disabled={rows.length === 0}
            >
              Exportar JSON
            </button>
          </>
        }
      />

      <Card>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="label">Nível</span>
              <select className="input" value={nivel} onChange={(event) => setNivel(event.target.value)}>
                {NIVEIS.map((option) => (
                  <option key={option || 'todos'} value={option}>
                    {option || 'Todos'}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="label">Busca</span>
              <input
                className="input"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="tipo de evento, endpoint, motivo…"
              />
            </label>
          </div>
        </CardBody>
      </Card>

      {logs.error ? <ErrorBox message={logs.error} /> : null}

      <Card>
        {logs.loading && !logs.data ? (
          <CardBody>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Carregando logs…
            </div>
          </CardBody>
        ) : rows.length === 0 ? (
          <CardBody>
            <EmptyState title="Sem logs" description="Nenhum evento corresponde aos filtros atuais." />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Quando</th>
                  <th className="th">Nível</th>
                  <th className="th">Evento</th>
                  <th className="th">Resultado</th>
                  <th className="th">Endpoint</th>
                  <th className="th">Lead</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="td whitespace-nowrap font-mono text-xs">{formatDateTimeBr(row.criadoEm)}</td>
                    <td className="td">
                      <Badge tone={levelTone(row.nivel)}>{row.nivel}</Badge>
                    </td>
                    <td className="td text-xs font-medium">{row.tipoEvento}</td>
                    <td className="td text-xs">{row.resultado ?? row.motivo ?? '—'}</td>
                    <td className="td max-w-[240px] truncate font-mono text-[11px] text-slate-500">
                      {row.endpoint ?? '—'}
                    </td>
                    <td className="td font-mono text-xs">{row.c2sLeadId ?? '—'}</td>
                    <td className="td text-right">
                      <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setSelected(row)}>
                        detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={selected !== null} title="Detalhe do evento" onClose={() => setSelected(null)}>
        {selected ? (
          <div className="space-y-2 text-sm">
            <Row label="ID" value={selected.id} mono />
            <Row label="Correlação" value={selected.correlationId} mono />
            <Row label="Quando" value={formatDateTimeBr(selected.criadoEm)} />
            <Row label="Evento" value={`${selected.tipoEvento} (${selected.nivel})`} />
            <Row label="Origem" value={selected.origem} />
            {selected.acaoExecutada ? <Row label="Ação" value={selected.acaoExecutada} /> : null}
            {selected.endpoint ? <Row label="Endpoint" value={selected.endpoint} mono /> : null}
            {selected.metodoHttp ? <Row label="Método" value={selected.metodoHttp} /> : null}
            {selected.statusHttp !== undefined ? <Row label="HTTP" value={String(selected.statusHttp)} /> : null}
            {selected.duracaoMs !== undefined ? <Row label="Duração" value={`${selected.duracaoMs} ms`} /> : null}
            {selected.motivo ? <Row label="Motivo" value={selected.motivo} /> : null}
            {selected.respostaResumida ? <Row label="Resposta" value={selected.respostaResumida} mono /> : null}
            {selected.payloadResumido ? <Row label="Payload" value={selected.payloadResumido} mono /> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`break-all text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
