import { useEffect, useState } from 'react';
import { CVRM_ENTRADA, CVRM_LIMITS, CVRM_ALVO } from '../../shared/constants/cvcrm';
import { stageLabel } from '../../shared/analysis/cvcrmPolicy';
import type { CvOverview } from '../../shared/types/cvcrm';
import { formatDateTimeBr } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { panelApi } from '../lib/panelApi';
import { ESTADO_MOVIMENTO, TOM_MOVIMENTO } from '../lib/cvcrmStatus';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorBox,
  Field,
  Notice,
  SectionTitle,
  Spinner,
  Stat,
  Toggle,
} from '../components/Ui';

const ESTADO_LABEL = ESTADO_MOVIMENTO;
const ESTADO_TONE = TOM_MOVIMENTO;

function CampoNumero({
  valor,
  min,
  max,
  disabled,
  onSalvar,
}: {
  valor: number;
  min: number;
  max: number;
  disabled: boolean;
  onSalvar: (valor: number) => void;
}): JSX.Element {
  const [texto, setTexto] = useState(String(valor));

  useEffect(() => {
    setTexto(String(valor));
  }, [valor]);

  return (
    <input
      type="number"
      className="input"
      value={texto}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(event) => setTexto(event.currentTarget.value)}
      onBlur={() => {
        const numero = Number.parseInt(texto, 10);
        if (!Number.isFinite(numero)) {
          setTexto(String(valor));
          return;
        }
        onSalvar(numero);
      }}
    />
  );
}

export function CvCrm(): JSX.Element {
  const overview = usePanelQuery<CvOverview>({ type: 'cvcrm' }, { autoRefreshMs: 5_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!aviso) return;
    const timer = window.setTimeout(() => setAviso(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [aviso]);

  const data = overview.data;

  const executar = async (id: string, action: () => Promise<unknown>, mensagem: string): Promise<void> => {
    setBusy(id);
    setErro(null);
    setAviso(null);
    try {
      await action();
      overview.refresh();
      setAviso(mensagem);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha na operação.');
    } finally {
      setBusy(null);
    }
  };

  const salvar = (patch: Record<string, unknown>, mensagem: string): void => {
    void executar('settings', () => panelApi.updateSettings(patch), mensagem);
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        title="CV CRM — mover etapa"
        description={`Move o lead de "${stageLabel(CVRM_ENTRADA)}" para "${stageLabel(CVRM_ALVO)}" quando ele cai na coluna amarela. O robô clica o mesmo botão que o corretor clicaria: nada é forjado, nada é arquivado.`}
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void executar('tick', () => panelApi.cvcrmTick(), 'Verificação solicitada.')}
            >
              Verificar agora
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => {
                if (
                  !window.confirm(
                    'Definir linha de base agora? Todo lead que já está na coluna de entrada passa a ser ignorado. Só os próximos serão movidos.',
                  )
                ) {
                  return;
                }
                void executar('baseline', () => panelApi.cvcrmBaseline(), 'Linha de base definida.');
              }}
            >
              Definir linha de base
            </button>
          </>
        }
      />

      {overview.error ? <ErrorBox message={overview.error} /> : null}
      {erro ? <ErrorBox message={erro} /> : null}
      {aviso ? <Notice tone="info">{aviso}</Notice> : null}

      {data && !data.ativo ? (
        <Notice tone="warn">
          <strong>Módulo desligado.</strong> Ligue o CV CRM abaixo para que a extensão observe o kanban. Nada é lido
          fora do navegador.
        </Notice>
      ) : null}

      {data && data.ativo && data.motivos.length > 0 ? (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Automação não liberada</h3>
              <Badge tone="amber">
                {data.motivos.length} de {data.requisitos.length} pendente(s)
              </Badge>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.requisitos.map((requisito) => (
                <li
                  key={requisito.chave}
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                    requisito.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
                  }`}
                >
                  <span aria-hidden className="mt-0.5 font-bold">
                    {requisito.ok ? '✓' : '✗'}
                  </span>
                  <span>
                    <span className="font-medium">{requisito.label}</span>
                    {!requisito.ok && requisito.motivo ? (
                      <span className="block text-xs opacity-80">{requisito.motivo}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              Todos os itens precisam estar ✓. Os três primeiros (build, opt-in e inspeção) valem para o C2S também.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {data && data.ativo && !data.kanbanAberto ? (
        <Notice tone="info">
          Deixe o kanban do CV CRM aberto numa aba: é dele que sai a detecção de lead novo e o contador de registros.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Linha de base"
          value={data?.baselineEm ? formatDateTimeBr(data.baselineEm) : '—'}
          hint={data ? `${data.ignorados} lead(s) ignorados na ativação` : undefined}
          tone={data?.baselineEm ? 'default' : 'warn'}
        />
        <Stat
          label="Aguardando movimento"
          value={data?.elegiveis.length ?? 0}
          hint="Na coluna de entrada e elegíveis"
          tone={data && data.elegiveis.length > 0 ? 'good' : 'default'}
        />
        <Stat
          label="Em andamento"
          value={data?.pendente ? ESTADO_LABEL[data.pendente.estado] : '—'}
          hint={data?.pendente ? `Lead ${data.pendente.leadId}` : 'Nenhum movimento pendente'}
          tone={data?.pendente ? 'warn' : 'default'}
        />
        <Stat
          label="Leads conhecidos"
          value={data?.conhecidos ?? 0}
          hint={
            data?.ultimoTickEm ? `Última leitura: ${formatDateTimeBr(data.ultimoTickEm)}` : 'Nenhuma leitura ainda'
          }
        />
      </div>

      <Card>
        <CardBody className="space-y-4">
          <Toggle
            checked={data?.modulo ?? false}
            onChange={(value) => salvar({ cvcrmEnabled: value }, value ? 'Módulo ligado.' : 'Módulo desligado.')}
            label="Módulo CV CRM"
            description="Observa o kanban e a página do lead. Não envia nada para servidor."
            disabled={busy !== null}
          />
          <Toggle
            checked={data?.mover ?? false}
            onChange={(value) => salvar({ cvcrmAutoMove: value }, value ? 'Mover etapa ligado.' : 'Mover etapa desligado.')}
            label="Mover etapa automaticamente"
            description={`Só de "${stageLabel(CVRM_ENTRADA)}" para "${stageLabel(CVRM_ALVO)}". Nunca descarta, nunca arquiva, nunca mexe em outra coluna.`}
            disabled={busy !== null}
          />
          <Toggle
            checked={data?.deteccao === 'KANBAN'}
            onChange={(value) =>
              salvar(
                { cvcrmDetection: value ? 'KANBAN' : 'TOAST' },
                value ? 'Detecção pelo kanban ligada.' : 'Detecção por aviso do CRM (sem requisições).',
              )
            }
            label="Detecção ativa no kanban"
            description="Desligado: usa só o aviso que o próprio CRM mostra (custo zero). Ligado: relê o quadro a cada ciclo para achar o lead mais rápido."
            disabled={busy !== null}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Espera antes de mover (s)" hint="Deixa o lead assentar no CRM.">
              <CampoNumero
                valor={data?.atrasoSeconds ?? 5}
                min={CVRM_LIMITS.delaySeconds.min}
                max={CVRM_LIMITS.delaySeconds.max}
                disabled={busy !== null}
                onSalvar={(valor) => salvar({ cvcrmDelaySeconds: valor }, 'Espera atualizada.')}
              />
            </Field>
            <Field label="Idade máxima (h)" hint="Passou disso, não move mais.">
              <CampoNumero
                valor={data?.idadeMaxHoras ?? 2}
                min={CVRM_LIMITS.maxAgeHours.min}
                max={CVRM_LIMITS.maxAgeHours.max}
                disabled={busy !== null}
                onSalvar={(valor) => salvar({ cvcrmMaxAgeHours: valor }, 'Idade máxima atualizada.')}
              />
            </Field>
            <Field label="Intervalo de leitura (s)" hint="Só no modo kanban.">
              <CampoNumero
                valor={data?.pollSeconds ?? 30}
                min={CVRM_LIMITS.pollSeconds.min}
                max={CVRM_LIMITS.pollSeconds.max}
                disabled={busy !== null}
                onSalvar={(valor) => salvar({ cvcrmPollSeconds: valor }, 'Intervalo atualizado.')}
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Tenant detectado: <strong>{data?.host || '—'}</strong> · Detecção:{' '}
            <strong>{data?.deteccao === 'KANBAN' ? 'kanban' : 'aviso do CRM'}</strong>
          </p>
        </CardBody>
      </Card>

      {!data && overview.loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Carregando estado do CV CRM…
        </div>
      ) : (data?.movimentos.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhum movimento registrado"
          description="Assim que um lead novo cair na coluna de entrada, ele aparece aqui com o resultado da tentativa."
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Etapa</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.movimentos ?? []).map((movimento) => (
                  <tr key={movimento.id} className="align-top">
                    <td className="py-2 pr-3 font-medium text-slate-800">#{movimento.leadId}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {movimento.de !== undefined ? `${movimento.de} → ${movimento.para ?? '?'}` : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={ESTADO_TONE[movimento.estado]}>{ESTADO_LABEL[movimento.estado]}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{formatDateTimeBr(movimento.atualizadoEm)}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{movimento.motivo ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {data && data.elegiveis.length > 0 ? (
        <Notice tone="info">
          <strong>Na fila:</strong> {data.elegiveis.map((lead) => `#${lead.leadId}`).join(', ')}
        </Notice>
      ) : null}

      <Notice tone="info">
        O pós-check é a própria página: depois do clique, o lead precisa recarregar com a etapa{' '}
        <strong>{CVRM_ALVO}</strong> ativa. Se não recarregar, o movimento é marcado como falha, o corretor é avisado e
        aquele lead não é tentado de novo.
      </Notice>
    </div>
  );
}
