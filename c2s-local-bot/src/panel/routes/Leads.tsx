import { useMemo, useState } from 'react';
import type { LeadRecord } from '../../shared/types/lead';
import { formatDateTimeBr, formatDuration } from '../../shared/utils/dateUtils';
import { formatPhoneBr } from '../../shared/utils/phoneUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { Badge, Card, CardBody, EmptyState, ErrorBox, Notice, SectionTitle, Spinner } from '../components/Ui';

const STATUS_TONES: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  NOVO: 'blue',
  CAPTURANDO: 'amber',
  CAPTURADO: 'green',
  PERDIDO: 'red',
  EM_ATENDIMENTO: 'blue',
  AGUARDANDO_RESPOSTA: 'amber',
  MENSAGEM_ENVIADA: 'green',
  MENSAGEM_FALHOU: 'red',
  ERRO: 'red',
  CANCELADO: 'slate',
};

export function Leads(): JSX.Element {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');
  const [origem, setOrigem] = useState('');
  const leads = usePanelQuery<LeadRecord[]>({
    type: 'leads',
    limit: 200,
    filters: {
      ...(busca ? { busca } : {}),
      ...(status ? { statusLocal: status } : {}),
      ...(origem ? { origemTipo: origem } : {}),
    },
  });

  const rows = useMemo(() => leads.data ?? [], [leads.data]);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Leads"
        description="Registro local dos leads detectados. Nesta versão (F1/F2) nenhum lead é capturado ou movimentado automaticamente."
        actions={
          <button type="button" className="btn-secondary" onClick={leads.refresh} disabled={leads.loading}>
            Atualizar
          </button>
        }
      />

      <Notice tone="info">
        A captura do Bolsão e a movimentação de funil ficam bloqueadas até a calibração ser confirmada e a licença
        liberar os recursos.
      </Notice>

      <Card>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="label">Busca</span>
              <input
                className="input"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="nome, telefone, imóvel ou ID C2S"
              />
            </label>
            <label className="text-sm">
              <span className="label">Status local</span>
              <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Todos</option>
                {Object.keys(STATUS_TONES).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="label">Origem</span>
              <select className="input" value={origem} onChange={(event) => setOrigem(event.target.value)}>
                <option value="">Todas</option>
                <option value="BOLSAO">Bolsão</option>
                <option value="DIRETO">Direto</option>
                <option value="DESCONHECIDA">Desconhecida</option>
              </select>
            </label>
          </div>
        </CardBody>
      </Card>

      {leads.error ? <ErrorBox message={leads.error} /> : null}

      <Card>
        {leads.loading && !leads.data ? (
          <CardBody>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Carregando leads…
            </div>
          </CardBody>
        ) : rows.length === 0 ? (
          <CardBody>
            <EmptyState
              title="Nenhum lead registrado"
              description="Os leads aparecem aqui quando a automação estiver liberada. Durante a inspeção, os dados ficam apenas nas amostras de calibração."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Lead C2S</th>
                  <th className="th">Nome</th>
                  <th className="th">Telefone</th>
                  <th className="th">Origem</th>
                  <th className="th">Status</th>
                  <th className="th">Detectado</th>
                  <th className="th">Captura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50">
                    <td className="td font-mono text-xs">{lead.c2sLeadId}</td>
                    <td className="td font-medium">{lead.nome ?? '—'}</td>
                    <td className="td">{lead.telefone ? formatPhoneBr(lead.telefone) : lead.telefoneMasked ?? '—'}</td>
                    <td className="td">
                      <Badge tone={lead.origemTipo === 'BOLSAO' ? 'violet' : 'slate'}>{lead.origemTipo}</Badge>
                    </td>
                    <td className="td">
                      <Badge tone={STATUS_TONES[lead.statusLocal] ?? 'slate'}>{lead.statusLocal}</Badge>
                    </td>
                    <td className="td whitespace-nowrap text-xs">{formatDateTimeBr(lead.detectadoEm)}</td>
                    <td className="td whitespace-nowrap text-xs">{formatDuration(lead.tempoCapturaMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
