import { useRef, useState, type ReactNode } from 'react';
import type {
  CalibrationContract,
  CalibrationReadiness,
  ContractConfidence,
  DomSample,
  InspectionStatus,
  NetworkSample,
  SelectorProfile,
} from '../../shared/types/inspection';
import type { Settings } from '../../shared/types/settings';
import { formatDateTimeBr } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { downloadJson, panelApi } from '../lib/panelApi';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorBox,
  Notice,
  SectionTitle,
  Spinner,
  Toggle,
} from '../components/Ui';

type Sample = NetworkSample | DomSample | SelectorProfile;

const CONCEPT_LABELS: Array<{ key: keyof CalibrationReadiness['counts']; label: string; minimo: number }> = [
  { key: 'bucketListResponse', label: 'Lista do Bolsão', minimo: 1 },
  { key: 'captureGet', label: 'GET captura', minimo: 1 },
  { key: 'capturePost', label: 'POST captura', minimo: 1 },
  { key: 'leadsV2Response', label: '/leads/v2', minimo: 1 },
  { key: 'leadDetailPage', label: 'Detalhe do lead', minimo: 1 },
  { key: 'contactsListPage', label: 'Lista de contatos', minimo: 1 },
  { key: 'bucketPage', label: 'Página do Bolsão', minimo: 1 },
  { key: 'domSamples', label: 'Amostras DOM', minimo: 2 },
  { key: 'selectorProfiles', label: 'Perfis de seletor', minimo: 1 },
];

export function Inspection(): JSX.Element {
  const status = usePanelQuery<InspectionStatus>({ type: 'inspection:status' }, { autoRefreshMs: 10_000 });
  const readiness = usePanelQuery<CalibrationReadiness>({ type: 'calibration:readiness' });
  const contract = usePanelQuery<CalibrationContract>({ type: 'calibration:contract' });
  const samples = usePanelQuery<Sample[]>({ type: 'inspection:samples', kind: 'network', limit: 100 });
  const settings = usePanelQuery<Settings>({ type: 'settings' });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [selected, setSelected] = useState<NetworkSample | null>(null);

  const active = status.data?.inspectMode ?? true;
  const counts = readiness.data?.counts ?? status.data?.counts;
  const pendencias = readiness.data?.pendencias ?? [];
  const avisos = readiness.data?.avisos ?? [];
  const pronto = readiness.data?.pronto ?? false;

  const run = async (label: string, action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(label);
    setErro(null);
    setAviso(null);
    try {
      await action();
      setAviso(success);
      status.refresh();
      readiness.refresh();
      contract.refresh();
      samples.refresh();
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha na operação.');
    } finally {
      setBusy(null);
    }
  };

  const exportBundle = async (includePii: boolean): Promise<void> => {
    await run(
      'export',
      async () => {
        const bundle = await panelApi.exportCalibration(includePii);
        downloadJson(`c2s-calibracao-${new Date().toISOString().slice(0, 10)}.json`, bundle);
      },
      'Bundle exportado. Envie o arquivo para análise.',
    );
  };

  const importBundle = async (file: File): Promise<void> => {
    await run(
      'import',
      async () => {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        await panelApi.importCalibration(parsed);
      },
      'Bundle importado.',
    );
  };

  const rows = (samples.data ?? []).filter(
    (sample): sample is NetworkSample => typeof sample === 'object' && sample !== null && 'endpointType' in sample,
  );

  const copyContract = async (): Promise<void> => {
    if (!contract.data) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(contract.data, null, 2));
      setErro(null);
      setAviso('Contrato copiado para a área de transferência.');
    } catch {
      setErro('Não foi possível copiar o contrato. Use "Exportar bundle".');
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Inspeção e calibração"
        description="Grava amostras reais do C2S (URL, método, payload, resposta, HTML, seletores e tempo) para calibrar o robô com evidência, não com suposição."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void run('dom', () => panelApi.captureDom(), 'Captura de DOM solicitada.')}
            >
              Capturar HTML
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void run('sel', () => panelApi.profileSelectors(), 'Perfil de seletores solicitado.')}
            >
              Perfil de seletores
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void run('shot', () => panelApi.requestScreenshot(), 'Screenshot solicitado.')}
            >
              Screenshot
            </button>
          </>
        }
      />

      {!active ? (
        <Notice tone="warn">
          O modo inspeção está desligado. Ligue-o acima para gravar amostras. Sem inspeção, o robô não executa nenhuma
          automação nesta versão.
        </Notice>
      ) : (
        <Notice tone="info">
          Com a inspeção ligada, o robô <strong>não captura, não move e não envia mensagens</strong>. Ele apenas observa.
          Deixe a aba do C2S ativa na janela para o screenshot.
        </Notice>
      )}

      {erro ? <ErrorBox message={erro} /> : null}
      {aviso ? <Notice tone="info">{aviso}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Cobertura das amostras</h3>
              {pronto ? <Badge tone="green">Pronto para confirmar</Badge> : <Badge tone="amber">Incompleto</Badge>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {CONCEPT_LABELS.map((item) => {
                const valor = counts?.[item.key] ?? 0;
                const ok = valor >= item.minimo;
                return (
                  <div key={item.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-700">{item.label}</span>
                    <span className={`text-sm font-semibold ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {valor}/{item.minimo}
                    </span>
                  </div>
                );
              })}
            </div>

            {pendencias.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pendências</p>
                <ul className="list-inside list-disc text-sm text-slate-600">
                  {pendencias.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {avisos.length > 0 ? (
              <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-800">
                  Avisos (não bloqueiam)
                </p>
                <ul className="list-inside list-disc text-xs text-sky-900">
                  {avisos.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Privacidade da amostra</h3>
            <Toggle
              label="Incluir PII nas amostras"
              description="Telefone, e-mail e CPF ficam visíveis apenas no seu navegador. Desligado = mascarado."
              checked={settings.data?.inspectIncludePii ?? false}
              onChange={(value) => {
                void panelApi.updateSettings({ inspectIncludePii: value }).then(() => settings.refresh());
              }}
            />
            <Toggle
              label="Capturar screenshots"
              description="Ajuda a validar o layout. Guardados por 7 dias (máx. 200)."
              checked={settings.data?.inspectCaptureScreenshots ?? true}
              onChange={(value) => {
                void panelApi.updateSettings({ inspectCaptureScreenshots: value }).then(() => settings.refresh());
              }}
            />
            <div className="border-t border-slate-200 pt-3 text-xs text-slate-500">
              Retenção: logs 30d · leads 90d · métricas 12m · screenshots 7d.
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Contrato detectado</h3>
              <p className="mt-1 max-w-2xl text-xs text-slate-500">
                Inferido só a partir das amostras reais. Nada aqui é suposição: cada campo mostra a confiança e a
                quantidade de evidência.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={contract.refresh} disabled={contract.loading}>
                Atualizar
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!contract.data}
                onClick={() => void copyContract()}
              >
                Copiar contrato
              </button>
            </div>
          </div>

          {contract.error ? <ErrorBox message={contract.error} /> : null}

          {!contract.data ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Analisando amostras…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <ContractBlock
                  title="Lista do Bolsão"
                  confidence={contract.data.bucketList?.confianca ?? 'AUSENTE'}
                >
                  {contract.data.bucketList ? (
                    <div className="space-y-1">
                      <ContractRow label="Endpoint" value={`${contract.data.bucketList.metodo} ${contract.data.bucketList.caminho}`} />
                      <ContractRow label="Origem" value={contract.data.bucketList.origem} />
                      <ContractRow label="Formato" value={contract.data.bucketList.formato} />
                      <ContractRow
                        label="Itens"
                        value={
                          contract.data.bucketList.caminhoItens
                            ? `${contract.data.bucketList.caminhoItens} (${contract.data.bucketList.chavesItem.length} chaves)`
                            : contract.data.bucketList.origem === 'DOM'
                              ? `${contract.data.bucketList.totalNoPool ?? 0} card(s) no pool${
                                  contract.data.bucketList.cardClasses?.length
                                    ? ` · ${contract.data.bucketList.cardClasses.join(', ')}`
                                    : ''
                                }`
                              : 'não reconhecidos'
                        }
                      />
                      <ContractRow
                        label="Chaves"
                        value={contract.data.bucketList.chavesItem.slice(0, 12).join(', ') || '—'}
                      />
                      <ContractRow label="Evidência" value={`${contract.data.bucketList.evidencia.amostras} amostra(s)`} />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Nenhuma resposta 2xx de /webapp/bucket_leads.</p>
                  )}
                </ContractBlock>

                <ContractBlock title="Captura" confidence={contract.data.capture?.confianca ?? 'AUSENTE'}>
                  {contract.data.capture ? (
                    <div className="space-y-1">
                      <ContractRow label="Aprovação" value={`POST ${contract.data.capture.caminho}`} />
                      <ContractRow label="Origem" value={contract.data.capture.origem} />
                      <ContractRow
                        label="Observado"
                        value={`GET: ${contract.data.capture.getObservado ? 'sim' : 'não'} · POST: ${
                          contract.data.capture.postObservado ? 'sim' : 'não'
                        } · confirmado: ${contract.data.capture.postConfirmado ? 'sim' : 'não'}`}
                      />
                      <ContractRow
                        label="Payload"
                        value={`${contract.data.capture.formatoPayload}${
                          contract.data.capture.chavesPayload.length > 0
                            ? ` (${contract.data.capture.chavesPayload.join(', ')})`
                            : ''
                        }`}
                      />
                      <ContractRow
                        label="CSRF"
                        value={contract.data.capture.headersCsrf.join(', ') || 'nenhum header observado'}
                      />
                      <ContractRow
                        label="Sucesso"
                        value={contract.data.capture.sinaisSucesso.join(', ') || 'não reconhecido'}
                      />
                      <ContractRow
                        label="Falha"
                        value={contract.data.capture.sinaisFalha.join(', ') || 'não reconhecido'}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Nenhuma chamada em /bucket_leads/&#123;id&#125;.</p>
                  )}
                </ContractBlock>

                <ContractBlock title="Gate de interação" confidence={contract.data.gate.confianca}>
                  <div className="space-y-1">
                    <ContractRow
                      label="Modal de bloqueio"
                      value={contract.data.gate.modalObservado ? 'presente' : 'ausente nas amostras'}
                    />
                    <ContractRow
                      label="Seletores"
                      value={contract.data.gate.modalSelectors.join(', ') || '—'}
                    />
                    <ContractRow
                      label="Free tier"
                      value={`${contract.data.gate.freeTierValor} · ${
                        contract.data.gate.freeTierBloqueado ? 'bloqueio detectado' : 'sem bloqueio'
                      }`}
                    />
                    <ContractRow label="DOM" value={`${contract.data.gate.amostrasDom} amostra(s)`} />
                  </div>
                </ContractBlock>

                <ContractBlock
                  title="Seletores críticos"
                  confidence={
                    contract.data.seletores.entradas.length > 0
                      ? contract.data.seletores.entradas.some((item) => item.confianca === 'ALTA')
                        ? 'ALTA'
                        : 'MEDIA'
                      : 'AUSENTE'
                  }
                >
                  <div className="space-y-1">
                    <ContractRow
                      label="Validados"
                      value={`${contract.data.seletores.entradas.length}/${
                        contract.data.seletores.entradas.length + contract.data.seletores.faltando.length
                      }`}
                    />
                    <ContractRow
                      label="Faltando"
                      value={contract.data.seletores.faltando.slice(0, 12).join(', ') || 'nenhum'}
                    />
                  </div>
                </ContractBlock>
              </div>

              {contract.data.conflitos.length > 0 ? (
                <Notice tone="warn">
                  <strong>Conflitos:</strong> {contract.data.conflitos.join(' ')}
                </Notice>
              ) : null}

              {contract.data.pendencias.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    O que falta para fechar o contrato
                  </p>
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-900">
                    {contract.data.pendencias.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Notice tone="info">Contrato completo pelas amostras atuais. Ainda assim, confirme com uma captura de teste.</Notice>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null || !pronto}
              onClick={() => void run('confirm', () => panelApi.confirmCalibration(), 'Calibração confirmada.')}
            >
              Confirmar calibração
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void exportBundle(false)}
            >
              Exportar bundle (sem PII)
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy !== null}
              onClick={() => void exportBundle(true)}
            >
              Exportar bundle (com PII)
            </button>
            <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              Importar bundle
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBundle(file);
                event.target.value = '';
              }}
            />
            <div className="ml-auto">
              <button
                type="button"
                className="btn-danger"
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm('Apagar todas as amostras de inspeção e a confirmação de calibração?')) return;
                  void run('clear', () => panelApi.clearData('inspection'), 'Amostras apagadas.');
                }}
              >
                Limpar amostras
              </button>
            </div>
          </div>

          {busy ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Executando {busy}…
            </div>
          ) : null}

          {readiness.data?.confirmedAt ? (
            <p className="mt-3 text-xs text-slate-500">
              Confirmação registrada em {formatDateTimeBr(readiness.data.confirmedAt)} · fingerprint{' '}
              <span className="font-mono">{readiness.data.appFingerprint}</span>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Amostras de rede</h3>
            <button type="button" className="btn-secondary" onClick={samples.refresh} disabled={samples.loading}>
              Atualizar
            </button>
          </div>

          {samples.error ? <ErrorBox message={samples.error} /> : null}

          {samples.loading && !samples.data ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Carregando…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nenhuma amostra de rede"
              description="Com a inspeção ligada, navegue pelo Bolsão, abra um lead e faça uma captura manual para registrar as chamadas."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Quando</th>
                    <th className="th">Endpoint</th>
                    <th className="th">Método</th>
                    <th className="th">HTTP</th>
                    <th className="th">URL</th>
                    <th className="th">ms</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((sample) => (
                    <tr key={sample.id} className="hover:bg-slate-50">
                      <td className="td whitespace-nowrap font-mono text-[11px]">{formatDateTimeBr(sample.timestamp)}</td>
                      <td className="td">
                        <Badge tone={sample.endpointType === 'DESCONHECIDO' ? 'slate' : 'blue'}>{sample.endpointType}</Badge>
                      </td>
                      <td className="td font-mono text-xs">{sample.method}</td>
                      <td className="td text-xs">{sample.status ?? '—'}</td>
                      <td className="td max-w-[320px] truncate font-mono text-[11px] text-slate-500">{sample.url}</td>
                      <td className="td text-xs">{sample.durationMs ?? '—'}</td>
                      <td className="td text-right">
                        <button
                          type="button"
                          className="text-xs font-medium text-brand-600 hover:underline"
                          onClick={() => setSelected(sample)}
                        >
                          ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold">Amostra de rede</h3>
              <button type="button" className="text-slate-500" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <Detail label="URL" value={selected.url} mono />
              <Detail label="Método / status" value={`${selected.method} · ${selected.status ?? 'sem resposta'}`} />
              <Detail label="Endpoint" value={selected.endpointType} />
              <Detail label="Contexto" value={selected.pageContext ?? '—'} />
              <Detail label="Quando" value={formatDateTimeBr(selected.timestamp)} />
              <Detail label="Duração" value={selected.durationMs !== undefined ? `${selected.durationMs} ms` : '—'} />
              {selected.requestHeaders ? (
                <Detail label="Headers da requisição" value={JSON.stringify(selected.requestHeaders, null, 2)} mono />
              ) : null}
              <Detail label="Payload enviado" value={selected.requestBody ?? '—'} mono />
              <Detail label="Resposta" value={selected.responseBody ?? '—'} mono />
              {selected.erro ? <Detail label="Erro" value={selected.erro} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <pre
        className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2 text-xs text-slate-800 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </pre>
    </div>
  );
}

function confidenceTone(confidence: ContractConfidence): 'green' | 'amber' | 'slate' | 'red' {
  if (confidence === 'ALTA') return 'green';
  if (confidence === 'MEDIA') return 'amber';
  if (confidence === 'BAIXA') return 'red';
  return 'slate';
}

function ContractBlock({
  title,
  confidence,
  children,
}: {
  title: string;
  confidence: ContractConfidence;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h4>
        <Badge tone={confidenceTone(confidence)}>{confidence}</Badge>
      </div>
      {children}
    </div>
  );
}

function ContractRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="break-all text-right font-mono text-[11px] text-slate-800">{value}</span>
    </div>
  );
}
