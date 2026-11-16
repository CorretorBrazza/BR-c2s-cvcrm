import { useEffect, useState } from 'react';
import type { LicenseState } from '../../shared/types/license';
import type { Settings } from '../../shared/types/settings';
import { formatDateTimeBr } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { panelApi } from '../lib/panelApi';
import { Badge, Card, CardBody, ErrorBox, Field, Notice, SectionTitle, Spinner } from '../components/Ui';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  VALIDA: 'green',
  TOLERANCIA_OFFLINE: 'amber',
  EXPIRADA: 'red',
  INVALIDA: 'red',
  NAO_CONFIGURADA: 'slate',
};

const FEATURE_LABELS: Array<{ key: keyof NonNullable<LicenseState['payload']>['features']; label: string }> = [
  { key: 'bucketCapture', label: 'Captura do Bolsão' },
  { key: 'autoStatus', label: 'Alteração de status' },
  { key: 'autoActivity', label: 'Criação de atividade' },
  { key: 'autoMessage', label: 'Envio de mensagem' },
  { key: 'metrics', label: 'Métricas avançadas' },
];

export function License(): JSX.Element {
  const settings = usePanelQuery<Settings>({ type: 'settings' });
  const license = usePanelQuery<LicenseState>({ type: 'license' });
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data?.licenseKey && texto === '') setTexto(settings.data.licenseKey);
  }, [settings.data, texto]);

  const aplicar = async (): Promise<void> => {
    setBusy(true);
    setErro(null);
    setAviso(null);
    try {
      await panelApi.updateSettings({ licenseKey: texto.trim() });
      settings.refresh();
      license.refresh();
      setAviso('Licença processada.');
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha ao validar a licença.');
    } finally {
      setBusy(false);
    }
  };

  const state = license.data;
  const features = state?.payload?.features;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Licença"
        description="Licença offline assinada com Ed25519. O arquivo .lic é verificado no seu navegador; nenhuma chave é enviada para servidor."
        actions={
          state?.status ? <Badge tone={STATUS_TONE[state.status] ?? 'slate'}>{state.status}</Badge> : null
        }
      />

      <Notice tone="info">
        Formato: JSON com <span className="font-mono">payload</span>, <span className="font-mono">signature</span> e{' '}
        <span className="font-mono">alg: "Ed25519"</span>. A chave pública vem compilada no build
        (<span className="font-mono">VITE_LICENSE_PUBLIC_KEY</span>).
      </Notice>

      {erro ? <ErrorBox message={erro} /> : null}
      {aviso ? <Notice tone="info">{aviso}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody className="space-y-3">
            <Field label="Conteúdo do arquivo .lic" hint="Cole o JSON completo. Nada é enviado para fora.">
              <textarea
                className="input min-h-[220px] font-mono text-xs"
                value={texto}
                onChange={(event) => setTexto(event.target.value)}
                placeholder='{"payload":"...","signature":"...","alg":"Ed25519"}'
                spellCheck={false}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => void aplicar()} disabled={busy}>
                {busy ? 'Validando…' : 'Validar e salvar'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setTexto('');
                  void panelApi.updateSettings({ licenseKey: '' }).then(() => {
                    settings.refresh();
                    license.refresh();
                    setAviso('Licença removida.');
                  });
                }}
                disabled={busy}
              >
                Remover licença
              </button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Estado</h3>
            {license.loading && !state ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Spinner /> Verificando…
              </div>
            ) : state ? (
              <dl className="space-y-2 text-sm">
                <Row label="Status" value={state.status} />
                <Row label="Origem" value={state.origem} />
                <Row label="Cliente" value={state.payload?.customer ?? '—'} />
                <Row label="Plano" value={state.payload?.plan ?? '—'} />
                <Row label="ID" value={state.payload?.licenseId ?? '—'} />
                <Row label="Válida até" value={state.validoAte ? formatDateTimeBr(state.validoAte) : '—'} />
                <Row label="Tolerância até" value={state.toleranciaAte ? formatDateTimeBr(state.toleranciaAte) : '—'} />
                <Row label="Verificada em" value={state.verificadoEm ? formatDateTimeBr(state.verificadoEm) : '—'} />
                {state.motivo ? <Row label="Observação" value={state.motivo} /> : null}
              </dl>
            ) : (
              <p className="text-sm text-slate-500">Sem licença configurada.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Recursos liberados</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_LABELS.map((item) => {
              const enabled = features?.[item.key] === true;
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <span className="text-slate-700">{item.label}</span>
                  <Badge tone={enabled ? 'green' : 'slate'}>{enabled ? 'liberado' : 'bloqueado'}</Badge>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Mesmo com licença válida, a automação só é liberada quando a calibração estiver confirmada.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
