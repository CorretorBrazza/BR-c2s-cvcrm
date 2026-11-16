import { useEffect, useMemo, useState } from 'react';
import type { LeadWindow, LeadWindowState, WindowsOverview } from '../../shared/types/window';
import { isActionable, isTerminal, remainingMs, windowHealth } from '../../shared/analysis/windowPolicy';
import { formatDateTimeBr, formatDuration } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { panelApi } from '../lib/panelApi';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorBox,
  Notice,
  SectionTitle,
  Spinner,
  Stat,
} from '../components/Ui';

const ESTADO_LABEL: Record<LeadWindowState, string> = {
  DETECTADO: 'Detectado',
  ACAO_PENDENTE: 'Ação pendente',
  ACAO_EXECUTADA: 'Ação executada',
  INTERACAO_CONFIRMADA: 'Interação confirmada',
  BLOQUEADO: 'Bloqueado',
  EXPIRADO: 'Expirado',
  FALHA: 'Falha',
};

const ESTADO_TONE: Record<LeadWindowState, 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet'> = {
  DETECTADO: 'blue',
  ACAO_PENDENTE: 'amber',
  ACAO_EXECUTADA: 'violet',
  INTERACAO_CONFIRMADA: 'green',
  BLOQUEADO: 'amber',
  EXPIRADO: 'red',
  FALHA: 'red',
};

function deadlineTone(window: LeadWindow, now: number): 'slate' | 'green' | 'amber' | 'red' {
  if (isTerminal(window)) return 'slate';
  const health = windowHealth(window, now);
  if (health === 'VENCIDA') return 'red';
  if (health === 'VENCENDO' || health === 'ATENCAO') return 'amber';
  return 'green';
}

export function Windows(): JSX.Element {
  const overview = usePanelQuery<WindowsOverview>({ type: 'windows' }, { autoRefreshMs: 5_000 });
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const timer = window.setTimeout(() => setAviso(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [aviso]);

  const data = overview.data;
  const janelas = useMemo(() => data?.janelas ?? [], [data]);

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

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Janelas de interação"
        description="Todo lead — do Bolsão ou da sua lista — ganha um prazo. O Bolsão é uma corrida curta; lead normal tem a janela configurada. Nada é enviado para fora do navegador."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() =>
                void executar('tick', () => panelApi.windowsTick(), 'Verificação solicitada ao service worker.')
              }
            >
              Verificar agora
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() =>
                void executar(
                  'clear-terminal',
                  () => panelApi.clearWindows('terminal'),
                  'Janelas encerradas antigas foram removidas.',
                )
              }
            >
              Limpar encerradas
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy !== null}
              onClick={() => {
                if (!window.confirm('Apagar TODAS as janelas? O histórico de prazos é perdido.')) return;
                void executar('clear-all', () => panelApi.clearWindows('all'), 'Janelas apagadas.');
              }}
            >
              Apagar tudo
            </button>
          </>
        }
      />

      {overview.error ? <ErrorBox message={overview.error} /> : null}
      {erro ? <ErrorBox message={erro} /> : null}
      {aviso ? <Notice tone="info">{aviso}</Notice> : null}

      {data?.poolPausado.pausado ? (
        <Notice tone="warn">
          <strong>Bolsão pausado.</strong> {data.poolPausado.motivo}
          {data.poolPausado.c2sLeadId ? ` Lead ${data.poolPausado.c2sLeadId}.` : ''} Assim que a interação com esse lead for
          confirmada, o pool volta a ser monitorado.
        </Notice>
      ) : null}

      {data && data.motivosBloqueio.length > 0 ? (
        <Notice tone="warn">
          <strong>Automação não liberada.</strong>
          <ul className="mt-1 list-inside list-disc">
            {data.motivosBloqueio.map((motivo) => (
              <li key={motivo}>{motivo}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {data && data.avisos.length > 0 ? (
        <Notice tone="info">
          <ul className="list-inside list-disc">
            {data.avisos.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Janelas ativas"
          value={
            (data?.stats.DETECTADO ?? 0) + (data?.stats.ACAO_PENDENTE ?? 0) + (data?.stats.ACAO_EXECUTADA ?? 0)
          }
          hint={data?.ultimoTickEm ? `Último tick: ${formatDateTimeBr(data.ultimoTickEm)}` : 'Nenhum tick ainda'}
          tone={data?.abaRespondeu ? 'default' : 'warn'}
        />
        <Stat label="Bloqueadas" value={data?.stats.BLOQUEADO ?? 0} tone={data && data.stats.BLOQUEADO > 0 ? 'warn' : 'default'} />
        <Stat
          label="Protegidas (confirmadas)"
          value={data?.stats.INTERACAO_CONFIRMADA ?? 0}
          tone="good"
          hint="Interação comprovada no C2S"
        />
        <Stat
          label="Perdidas"
          value={(data?.stats.EXPIRADO ?? 0) + (data?.stats.FALHA ?? 0)}
          tone={data && (data.stats.EXPIRADO > 0 || data.stats.FALHA > 0) ? 'bad' : 'default'}
          hint="Prazo vencido ou erro definitivo"
        />
      </div>

      {!data && overview.loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Carregando janelas…
        </div>
      ) : janelas.length === 0 ? (
        <EmptyState
          title="Nenhuma janela registrada"
          description="Abra o C2S na aba de Bolsão ou na lista de contatos. A extensão registra cada lead novo com o prazo correspondente."
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Origem</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Prazo</th>
                  <th className="py-2 pr-3">Restante</th>
                  <th className="py-2 pr-3">Detalhe</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {janelas.map((janela) => {
                  const restante = remainingMs(janela, now);
                  const podeConfirmar = janela.estado === 'ACAO_EXECUTADA';
                  const podeTentar = isActionable(janela, now) && !podeConfirmar;
                  return (
                    <tr key={janela.id} className="align-top">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-slate-800">{janela.nome ?? `Lead ${janela.c2sLeadId}`}</p>
                        <p className="text-[11px] text-slate-500">ID {janela.c2sLeadId}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={janela.origem === 'POOL' ? 'violet' : 'blue'}>
                          {janela.origem === 'POOL' ? 'Bolsão' : 'Normal'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={ESTADO_TONE[janela.estado]}>{ESTADO_LABEL[janela.estado]}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{formatDateTimeBr(janela.prazoEm)}</td>
                      <td className="py-2 pr-3">
                        {isTerminal(janela) ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <Badge tone={deadlineTone(janela, now)}>{formatDuration(restante)}</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {janela.bloqueio ?? janela.ultimoErro ?? `${janela.tentativas} tentativa(s)`}
                      </td>
                      <td className="py-2 text-right">
                        {podeConfirmar ? (
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            disabled={busy !== null}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  'Confirmar que você já interagiu com este lead no C2S? Isso libera o Bolsão.',
                                )
                              ) {
                                return;
                              }
                              void executar(
                                janela.id,
                                () => panelApi.confirmInteraction(janela.c2sLeadId),
                                'Interação confirmada.',
                              );
                            }}
                          >
                            Confirmar interação
                          </button>
                        ) : podeTentar ? (
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={busy !== null}
                            onClick={() =>
                              void executar('tick', () => panelApi.windowsTick(), 'Verificação solicitada.')
                            }
                          >
                            Tentar agora
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Notice tone="info">
        A ação automática só roda com build habilitado, opt-in registrado, calibração confirmada, licença válida e modo
        inspeção desligado. Enquanto a criação de atividade não for calibrada com uma amostra real, leads normais são
        detectados e alertados, mas a escrita fica bloqueada.
      </Notice>
    </div>
  );
}
