import type { ReactNode } from 'react';
import { C2S_ORIGIN, C2S_PATHS } from '../../shared/constants/endpoints';
import { CVRM_ENTRADA, CVRM_ALVO } from '../../shared/constants/cvcrm';
import { stageLabel } from '../../shared/analysis/cvcrmPolicy';
import type { DailyMetrics, MonthlyMetrics } from '../../shared/types/metrics';
import type { Settings } from '../../shared/types/settings';
import type { CalibrationReadiness } from '../../shared/types/inspection';
import type { LicenseState } from '../../shared/types/license';
import type { WindowsOverview } from '../../shared/types/window';
import type { CvOverview } from '../../shared/types/cvcrm';
import { formatDateTimeBr, formatDuration } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { ESTADO_MOVIMENTO, TOM_MOVIMENTO } from '../lib/cvcrmStatus';
import { Badge, Card, CardBody, EmptyState, ErrorBox, Notice, SectionTitle } from '../components/Ui';

/**
 * Visão geral: os **dois produtos** lado a lado, com o mesmo peso.
 *
 * O robô é um só (mesmo service worker, mesma licença), mas ele age em dois
 * lugares diferentes: no C2S (Bolsão e leads) e no CV CRM (mover etapa). Esta
 * tela mostra o estado de cada um separadamente e, abaixo, o que é comum aos
 * dois — licença, opt-in, inspeção e os eventos recentes.
 */

interface NumeroProps {
  label: string;
  valor: ReactNode;
  hint?: string;
  tom?: 'default' | 'good' | 'warn' | 'bad';
}

function Numero({ label, valor, hint, tom = 'default' }: NumeroProps): JSX.Element {
  const cores: Record<string, string> = {
    default: 'text-slate-900',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
  };
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold leading-tight ${cores[tom] ?? cores.default}`}>{valor}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Detalhe({ label, valor }: { label: string; valor: ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{valor}</dd>
    </div>
  );
}

function PainelProduto({
  marca,
  descricao,
  status,
  cor,
  acoes,
  children,
}: {
  marca: string;
  descricao: string;
  status: ReactNode;
  cor: string;
  acoes: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className={`border-t-4 ${cor}`}>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">{marca}</h3>
            <p className="text-xs text-slate-500">{descricao}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{status}</div>
        </div>

        {children}

        <div className="flex flex-wrap items-center gap-2 pt-1">{acoes}</div>
      </CardBody>
    </Card>
  );
}

export function Dashboard(): JSX.Element {
  const metrics = usePanelQuery<{ hoje: DailyMetrics; mes: MonthlyMetrics }>(
    { type: 'metrics' },
    { autoRefreshMs: 30_000 },
  );
  const connection = usePanelQuery<{ conectado: boolean; abaC2sAberta: boolean; ultimoPingEm?: string }>(
    { type: 'connection' },
    { autoRefreshMs: 10_000 },
  );
  const settings = usePanelQuery<Settings>({ type: 'settings' });
  const readiness = usePanelQuery<CalibrationReadiness>({ type: 'calibration:readiness' });
  const windows = usePanelQuery<WindowsOverview>({ type: 'windows' }, { autoRefreshMs: 10_000 });
  const cvcrm = usePanelQuery<CvOverview>({ type: 'cvcrm' }, { autoRefreshMs: 10_000 });
  const license = usePanelQuery<LicenseState>({ type: 'license' }, { autoRefreshMs: 60_000 });
  const live = useLiveEvents(8);

  const hoje = metrics.data?.hoje;
  const mes = metrics.data?.mes;

  const conectado = connection.data?.conectado ?? false;
  const botActive = settings.data?.botActive ?? false;
  const inspectMode = settings.data?.inspectMode ?? true;
  const optIn = Boolean(settings.data?.automationOptInAt);
  const calibrado = Boolean(readiness.data?.pronto && readiness.data?.confirmedAt);

  const cv = cvcrm.data;
  const cvLigado = cv?.ativo ?? false;
  const cvMover = cv?.mover ?? false;
  const cvLiberado = cv?.automacao ?? false;

  const janelasAtivas =
    (windows.data?.stats.DETECTADO ?? 0) +
    (windows.data?.stats.ACAO_PENDENTE ?? 0) +
    (windows.data?.stats.ACAO_EXECUTADA ?? 0);
  const bolsaoPausado = windows.data?.poolPausado.pausado ?? false;

  const licencaOk = license.data?.status === 'VALIDA' || license.data?.status === 'TOLERANCIA_OFFLINE';

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Visão geral"
        description="Dois produtos, um robô local: C2S (Bolsão e leads) e CV CRM (mover etapa). Nada sai deste navegador."
      />

      {metrics.error ? <ErrorBox message={metrics.error} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------ C2S ------------------------------ */}
        <PainelProduto
          marca="C2S"
          descricao="Bolsão, leads e janelas de interação"
          cor="border-t-brand-600"
          status={
            <>
              <Badge tone={botActive ? 'green' : 'slate'}>{botActive ? 'Robô ativo' : 'Robô pausado'}</Badge>
              <Badge tone={conectado ? 'green' : 'amber'}>{conectado ? 'Conectado' : 'Sem aba'}</Badge>
              <Badge tone={calibrado ? 'green' : 'amber'}>{calibrado ? 'Calibrado' : 'Calibração pendente'}</Badge>
            </>
          }
          acoes={
            <>
              <a className="btn-secondary text-xs" href={`${C2S_ORIGIN}${C2S_PATHS.leadsV2}`} target="_blank" rel="noreferrer">
                Abrir C2S
              </a>
              <a className="btn-secondary text-xs" href="#/windows">
                Janelas
              </a>
              <a className="btn-secondary text-xs" href="#/metrics">
                Métricas
              </a>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero label="Detectados" valor={hoje?.leadsDetectados ?? 0} hint="hoje" />
            <Numero
              label="Capturados"
              valor={hoje?.leadsCapturados ?? 0}
              hint={`${hoje?.leadsBolsao ?? 0} do Bolsão`}
              tom="good"
            />
            <Numero
              label="Perdidos"
              valor={hoje?.leadsPerdidos ?? 0}
              tom={hoje && hoje.leadsPerdidos > 0 ? 'bad' : 'default'}
            />
            <Numero
              label="Captura média"
              valor={formatDuration(hoje?.tempoMedioCapturaMs)}
              hint={mes ? `${mes.leadsCapturados} no mês` : undefined}
            />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Detalhe label="Aba do C2S" valor={connection.data?.abaC2sAberta ? 'Aberta' : 'Não detectada'} />
            <Detalhe
              label="Último sinal"
              valor={connection.data?.ultimoPingEm ? formatDateTimeBr(connection.data.ultimoPingEm) : '—'}
            />
            <Detalhe label="Janelas ativas" valor={janelasAtivas} />
            <Detalhe
              label="Bolsão"
              valor={bolsaoPausado ? 'Pausado' : 'Liberado'}
            />
            <Detalhe
              label="Calibração"
              valor={
                readiness.data?.pronto
                  ? calibracaoTexto(readiness.data.confirmedAt)
                  : 'Pendente'
              }
            />
            <Detalhe label="Modo inspeção" valor={inspectMode ? 'Ligado' : 'Desligado'} />
          </dl>

          {bolsaoPausado ? (
            <Notice tone="warn">
              <strong>Bolsão pausado.</strong> {windows.data?.poolPausado.motivo}
              {windows.data?.poolPausado.c2sLeadId ? ` Lead ${windows.data.poolPausado.c2sLeadId}.` : ''}
            </Notice>
          ) : windows.data && windows.data.motivosBloqueio.length > 0 ? (
            <p className="text-xs text-slate-500">
              Automação bloqueada: {windows.data.motivosBloqueio[0]}
              {windows.data.motivosBloqueio.length > 1
                ? ` (+${windows.data.motivosBloqueio.length - 1})`
                : ''}
            </p>
          ) : null}
        </PainelProduto>

        {/* ----------------------------- CV CRM ---------------------------- */}
        <PainelProduto
          marca="CV CRM"
          descricao={`Move o lead de "${stageLabel(CVRM_ENTRADA)}" para "${stageLabel(CVRM_ALVO)}"`}
          cor="border-t-amber-500"
          status={
            <>
              <Badge tone={cvLigado ? 'green' : 'slate'}>{cvLigado ? 'Módulo ligado' : 'Desligado'}</Badge>
              {cvLigado ? (
                <Badge tone={cvMover ? (cvLiberado ? 'green' : 'amber') : 'blue'}>
                  {cvMover
                    ? cvLiberado
                      ? 'Movendo'
                      : `Movimento bloqueado · ${cv?.requisitos.filter((requisito) => !requisito.ok).length ?? 0}`
                    : 'Só observando'}
                </Badge>
              ) : null}
            </>
          }
          acoes={
            <>
              <a className="btn-secondary text-xs" href="#/cvcrm">
                Abrir CV CRM
              </a>
              <a className="btn-secondary text-xs" href="#/logs">
                Logs
              </a>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero
              label="Na fila"
              valor={cv?.elegiveis.length ?? 0}
              hint="elegíveis"
              tom={cv && cv.elegiveis.length > 0 ? 'good' : 'default'}
            />
            <Numero
              label="Em andamento"
              valor={cv?.pendente ? ESTADO_MOVIMENTO[cv.pendente.estado] : '—'}
              hint={cv?.pendente ? `lead ${cv.pendente.leadId}` : 'nenhum'}
              tom={cv?.pendente ? 'warn' : 'default'}
            />
            <Numero
              label="Ignorados"
              valor={cv?.ignorados ?? 0}
              hint="linha de base"
            />
            <Numero label="Conhecidos" valor={cv?.conhecidos ?? 0} hint="vistos no kanban" />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Detalhe
              label="Linha de base"
              valor={cv?.baselineEm ? formatDateTimeBr(cv.baselineEm) : 'Não definida'}
            />
            <Detalhe label="Kanban" valor={cv?.kanbanAberto ? 'Aberto' : 'Não detectado'} />
            <Detalhe label="Detecção" valor={cv?.deteccao === 'KANBAN' ? 'Kanban' : 'Aviso do CRM'} />
            <Detalhe
              label="Última leitura"
              valor={cv?.ultimoTickEm ? formatDateTimeBr(cv.ultimoTickEm) : '—'}
            />
            <Detalhe label="Tenant" valor={cv?.host || '—'} />
            <Detalhe
              label="Último resultado"
              valor={
                cv?.movimentos[0] ? (
                  <span className="flex items-center gap-1">
                    <Badge tone={TOM_MOVIMENTO[cv.movimentos[0].estado]}>
                      {ESTADO_MOVIMENTO[cv.movimentos[0].estado]}
                    </Badge>
                    <span className="text-xs text-slate-500">#{cv.movimentos[0].leadId}</span>
                  </span>
                ) : (
                  '—'
                )
              }
            />
          </dl>

          {cv && cv.ativo && cv.motivos.length > 0 ? (
            <Notice tone="warn">
              <strong>Movimento bloqueado.</strong>
              <ul className="mt-1 list-inside list-disc">
                {cv.motivos.slice(0, 3).map((motivo) => (
                  <li key={motivo}>{motivo}</li>
                ))}
                {cv.motivos.length > 3 ? <li>+{cv.motivos.length - 3} outro(s)</li> : null}
              </ul>
            </Notice>
          ) : null}

          {!cv && cvcrm.loading ? <p className="text-xs text-slate-500">Carregando estado do CV CRM…</p> : null}
        </PainelProduto>
      </div>

      {/* ---------------------------- Sistema ---------------------------- */}
      <Card>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Comum aos dois</h3>
            <a className="btn-secondary text-xs" href="#/settings">
              Configurações
            </a>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Detalhe
              label="Licença"
              valor={
                <span className="flex items-center gap-1">
                  <Badge tone={licencaOk ? 'green' : 'red'}>
                    {license.data?.status ? license.data.status.replace(/_/g, ' ') : '—'}
                  </Badge>
                </span>
              }
            />
            <Detalhe label="Opt-in da automação" valor={optIn ? 'Registrado' : 'Não registrado'} />
            <Detalhe label="Modo inspeção" valor={inspectMode ? 'Ligado (nada é automático)' : 'Desligado'} />
            <Detalhe label="Notificações" valor={settings.data?.desktopNotifications ? 'Ligadas' : 'Desligadas'} />
          </dl>

          {!optIn || !licencaOk || inspectMode ? (
            <div className="mt-3">
              <Notice tone="warn">
                <strong>Automação ainda bloqueada.</strong> Vale para os dois produtos. Falta:{' '}
                {[
                  !licencaOk ? 'licença válida' : null,
                  !optIn ? 'registrar o opt-in' : null,
                  inspectMode ? 'desligar o modo inspeção' : null,
                ]
                  .filter((item): item is string => item !== null)
                  .join(' · ')}
                .
              </Notice>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Eventos recentes</h3>
          {live.events.length === 0 ? (
            <EmptyState
              title="Nenhum evento ainda"
              description="Abra o C2S ou o kanban do CV CRM para que a extensão detecte a página e comece a registrar."
            />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {live.events.map((event) => {
                const doCv = event.tipoEvento.startsWith('CVRM_');
                return (
                  <li key={event.id} className="flex items-start justify-between gap-3 py-2">
                    <div>
                      <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-800">
                        <Badge tone={doCv ? 'amber' : 'blue'}>{doCv ? 'CV CRM' : 'C2S'}</Badge>
                        {event.tipoEvento}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {event.resultado ?? event.motivo ?? '—'}
                        {event.c2sLeadId ? ` · lead ${event.c2sLeadId}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{formatDateTimeBr(event.criadoEm)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function calibracaoTexto(confirmedAt?: string): string {
  return confirmedAt ? `Confirmada ${formatDateTimeBr(confirmedAt)}` : 'Amostras ok, falta confirmar';
}
