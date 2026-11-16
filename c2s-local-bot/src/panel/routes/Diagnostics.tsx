import { useEffect, useState } from 'react';
import { APP_VERSION } from '../../shared/constants/defaults';
import { BUILD_INFO, BUILD_MARKER } from '../../shared/constants/buildInfo';
import type { SelectorAuditReport } from '../../shared/types/audit';
import type { CalibrationReadiness, InspectionStatus } from '../../shared/types/inspection';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { downloadJson, panelApi, PanelApiError } from '../lib/panelApi';
import { Badge, Card, CardBody, ErrorBox, Notice, SectionTitle, Spinner } from '../components/Ui';

interface Diagnostic {
  nome: string;
  ok: boolean;
  detalhe: string;
}

function describeBuild(): string {
  return [
    `automação ${BUILD_INFO.automationEnabled ? 'LIGADA' : 'desligada'}`,
    BUILD_INFO.licenseKeyConfigured
      ? `chave pública ${BUILD_INFO.licenseKeyFormat}`
      : 'sem chave pública (nenhuma licença valida)',
    `ambiente ${BUILD_INFO.env}`,
  ].join(' · ');
}

export function Diagnostics(): JSX.Element {
  const connection = usePanelQuery<{ conectado: boolean; abaC2sAberta: boolean; ultimoPingEm?: string }>(
    { type: 'connection' },
    { autoRefreshMs: 10_000 },
  );
  const inspection = usePanelQuery<InspectionStatus>({ type: 'inspection:status' });
  const readiness = usePanelQuery<CalibrationReadiness>({ type: 'calibration:readiness' });
  const [storage, setStorage] = useState<string>('—');
  const [permissions, setPermissions] = useState<string>('—');
  const [erro, setErro] = useState<string | null>(null);
  const [audit, setAudit] = useState<SelectorAuditReport | null>(null);
  const [auditErro, setAuditErro] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (estimate?.usage !== undefined) {
          const used = (estimate.usage / 1024 / 1024).toFixed(2);
          const quota = estimate.quota ? (estimate.quota / 1024 / 1024).toFixed(0) : '?';
          setStorage(`${used} MB usados de ${quota} MB`);
        } else {
          setStorage('não informado pelo navegador');
        }
      } catch {
        setStorage('indisponível');
      }

      try {
        const perms = await chrome.permissions.getAll();
        setPermissions([...(perms.permissions ?? []), ...(perms.origins ?? [])].join(', ') || 'nenhuma');
      } catch {
        setPermissions('indisponível');
      }
    })();
  }, []);

  const checks: Diagnostic[] = [
    {
      nome: 'Automação neste build',
      // Sem isso o bot nunca age, por mais que tudo o resto esteja certo.
      ok: BUILD_INFO.automationEnabled,
      detalhe: BUILD_INFO.automationEnabled
        ? 'flag de automação embutida no pacote'
        : 'build sem automação: gere com VITE_AUTOMATION_ENABLED=true',
    },
    {
      nome: 'Chave de licença no build',
      ok: BUILD_INFO.licenseKeyConfigured,
      detalhe: BUILD_INFO.licenseKeyConfigured
        ? `chave ${BUILD_INFO.licenseKeyFormat} embutida`
        : 'sem chave pública: toda licença será recusada',
    },
    {
      nome: 'Service worker respondendo',
      ok: connection.error === null,
      detalhe: connection.error ?? 'consultas respondidas',
    },
    {
      nome: 'Aba do C2S aberta',
      ok: connection.data?.abaC2sAberta === true,
      detalhe: connection.data?.ultimoPingEm ? `último sinal: ${connection.data.ultimoPingEm}` : 'sem sinal',
    },
    {
      nome: 'Sessão autenticada',
      ok: connection.data?.conectado === true,
      detalhe: connection.data?.conectado ? 'heartbeat recente' : 'faça login no C2S',
    },
    {
      nome: 'Modo inspeção',
      ok: inspection.data?.inspectMode === true,
      detalhe: inspection.data?.inspectMode ? 'ligado' : 'desligado',
    },
    {
      nome: 'Calibração pronta',
      ok: readiness.data?.pronto === true,
      detalhe: readiness.data?.pronto
        ? `amostras mínimas coletadas${(readiness.data?.avisos.length ?? 0) > 0 ? ` · ${readiness.data?.avisos.length} aviso(s)` : ''}`
        : `${readiness.data?.pendencias.length ?? 0} pendência(s)`,
    },
    {
      nome: 'Calibração confirmada',
      ok: Boolean(readiness.data?.confirmedAt),
      detalhe: readiness.data?.confirmedAt ?? 'não confirmada',
    },
    {
      nome: 'Permissões',
      ok: permissions.includes('storage'),
      detalhe: permissions,
    },
    {
      nome: 'Armazenamento local',
      ok: storage !== '—',
      detalhe: storage,
    },
  ];

  const snapshot = {
    versao: APP_VERSION,
    geradoEm: new Date().toISOString(),
    build: { ...BUILD_INFO, marca: BUILD_MARKER },
    checks,
    counts: readiness.data?.counts ?? null,
    pendencias: readiness.data?.pendencias ?? [],
    permissões: permissions,
    armazenamento: storage,
    seletores: audit,
  };

  async function runAudit(): Promise<void> {
    setAuditBusy(true);
    setAuditErro(null);
    setCopiado(false);
    try {
      const report = await panelApi.auditSelectors<SelectorAuditReport>();
      setAudit(report);
    } catch (error) {
      setAuditErro(
        error instanceof PanelApiError
          ? error.message
          : 'Não foi possível auditar agora. Confirme que a aba do C2S está aberta.',
      );
    } finally {
      setAuditBusy(false);
    }
  }

  async function copiar(): Promise<void> {
    const texto = JSON.stringify(audit ?? snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2_500);
    } catch {
      // Sem clipboard (painel sem foco): cai para download, que sempre funciona.
      downloadJson(`c2s-auditoria-${Date.now()}.json`, audit ?? snapshot);
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Diagnóstico"
        description="Verificações rápidas para suporte. O relatório não inclui dados de leads nem conteúdo de conversas."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                connection.refresh();
                inspection.refresh();
                readiness.refresh();
                setErro(null);
              }}
            >
              Reexecutar
            </button>
            <button type="button" className="btn-secondary" onClick={() => downloadJson(`c2s-diagnostico-${Date.now()}.json`, snapshot)}>
              Exportar relatório
            </button>
          </>
        }
      />

      {erro ? <ErrorBox message={erro} /> : null}

      {connection.loading && !connection.data ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner /> Verificando…
        </div>
      ) : (
        <Card>
          <CardBody>
            <ul className="divide-y divide-slate-100">
              {checks.map((check) => (
                <li key={check.nome} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{check.nome}</p>
                    <p className="text-xs text-slate-500">{check.detalhe}</p>
                  </div>
                  <Badge tone={check.ok ? 'green' : 'amber'}>{check.ok ? 'ok' : 'atenção'}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Auditoria de seletores</h3>
              <p className="mt-1 max-w-xl text-xs text-slate-500">
                Testa, na aba atual do C2S, cada seletor que o bot usa. Se um conceito zerar depois de uma
                atualização do site, a automação para de agir — e isto mostra qual quebrou.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void runAudit()} disabled={auditBusy}>
                {auditBusy ? 'Auditando…' : 'Auditar aba do C2S'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void copiar()} disabled={!audit && !snapshot}>
                {copiado ? 'Copiado' : 'Copiar relatório'}
              </button>
            </div>
          </div>

          {auditErro ? <div className="mt-3"><ErrorBox message={auditErro} /></div> : null}

          {audit ? (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-slate-500">
                {audit.contexto} · {audit.url} · gerado em {audit.geradoEm} ·{' '}
                <span className={audit.conceitosSemMatch.length > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                  {audit.conceitosSemMatch.length === 0
                    ? 'todos os conceitos encontraram elementos'
                    : `${audit.conceitosSemMatch.length} conceito(s) sem nenhum elemento`}
                </span>
              </p>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-xs font-semibold text-slate-900">Sinais do Bolsão</h4>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-500">C2S indica</dt>
                    <dd className="font-mono text-slate-800">
                      {audit.sinais.bolsaoIndicado ?? 'não publicado'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Pool lido</dt>
                    <dd className="font-mono text-slate-800">{audit.sinais.poolLido}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Cards ativos</dt>
                    <dd className="font-mono text-slate-800">{audit.sinais.cardsAtivos}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Histórico</dt>
                    <dd className="font-mono text-slate-800">{audit.sinais.cardsHistorico}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Lista normal</dt>
                    <dd className="font-mono text-slate-800">{audit.sinais.normalLido}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Contador</dt>
                    <dd className="font-mono text-slate-800">
                      {audit.sinais.contadorSegundos !== undefined
                        ? `${audit.sinais.contadorSegundos}s`
                        : 'ausente'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Free tier</dt>
                    <dd className="font-mono text-slate-800">{audit.sinais.freeTier ? 'sim' : 'não'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Pool pausado pelo C2S</dt>
                    <dd className="font-mono text-slate-800">
                      {audit.sinais.bolsaoPausado ? 'sim' : 'não'}
                    </dd>
                  </div>
                </dl>
                {audit.sinais.diagnostico.length > 0 ? (
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-700">
                    {audit.sinais.diagnostico.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Nenhum sinal fora do esperado.</p>
                )}
                {audit.sinais.poolDetalhe.length > 0 ? (
                  <p className="mt-2 font-mono text-[11px] text-slate-500">
                    pool: {audit.sinais.poolDetalhe
                      .map((item) =>
                        item.segundosRestantes !== undefined
                          ? `${item.c2sLeadId} (${item.segundosRestantes}s)`
                          : `${item.c2sLeadId} (sem contador)`,
                      )
                      .join(' · ')}
                  </p>
                ) : null}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1 pr-3 font-semibold">Conceito</th>
                      <th className="py-1 pr-3 font-semibold">Encontrados</th>
                      <th className="py-1 pr-3 font-semibold">Visíveis</th>
                      <th className="py-1 pr-3 font-semibold">Amostra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.linhas.map((linha) => (
                      <tr key={linha.conceito} className="border-b border-slate-100">
                        <td className="py-1 pr-3 font-mono text-slate-700">{linha.conceito}</td>
                        <td className={`py-1 pr-3 ${linha.encontrados === 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                          {linha.encontrados}
                        </td>
                        <td
                          className={`py-1 pr-3 ${
                            linha.visiveis === 0 && linha.encontrados > 0
                              ? 'text-slate-400'
                              : 'text-slate-700'
                          }`}
                          title={
                            linha.visiveis === 0 && linha.encontrados > 0
                              ? 'Existe no DOM, mas está oculto agora'
                              : undefined
                          }
                        >
                          {linha.visiveis}
                        </td>
                        <td className="py-1 pr-3 font-mono text-slate-500">{linha.amostra ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Notice tone="info">
                O relatório traz contagem, assinatura de elemento (tag + classes) e o id do C2S dos cards
                do pool. Nenhum nome, telefone ou mensagem de lead é lido. “Encontrados” maior que zero com
                “Visíveis” zero significa elemento presente no DOM mas oculto agora — normal para modais.
              </Notice>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Nenhuma auditoria executada nesta sessão. Abra o C2S no Chrome e clique em “Auditar aba do C2S”.
            </p>
          )}
        </CardBody>
      </Card>

      <Notice tone="info">
        Versão {APP_VERSION} · {describeBuild()}. Se algum item falhar, recarregue a extensão em
        chrome://extensions e reabra a aba do C2S.
      </Notice>
    </div>
  );
}
