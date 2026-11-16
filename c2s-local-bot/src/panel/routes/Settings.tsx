import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types/settings';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { panelApi } from '../lib/panelApi';
import { Card, CardBody, ErrorBox, Field, Modal, Notice, SectionTitle, Spinner, Toggle } from '../components/Ui';

export function SettingsRoute(): JSX.Element {
  const settings = usePanelQuery<Settings>({ type: 'settings' });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [optInOpen, setOptInOpen] = useState(false);
  const [optInAccepted, setOptInAccepted] = useState(false);

  useEffect(() => {
    if (settings.data && draft === null) setDraft(settings.data);
  }, [settings.data, draft]);

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const salvar = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    setErro(null);
    setAviso(null);
    try {
      await panelApi.updateSettings(draft as unknown as Record<string, unknown>);
      settings.refresh();
      setAviso('Configurações salvas.');
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (settings.error) return <ErrorBox message={settings.error} />;
  if (!draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner /> Carregando configurações…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Configurações"
        description="Tudo fica no armazenamento local do navegador. Automações só funcionam depois da calibração confirmada e da licença correspondente."
        actions={
          <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        }
      />

      {erro ? <ErrorBox message={erro} /> : null}
      {aviso ? <Notice tone="info">{aviso}</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Automação</h3>
            <Notice tone="warn">
              A automação só roda quando o build foi gerado com <code>VITE_AUTOMATION_ENABLED=true</code>, o opt-in
              abaixo está registrado, a calibração foi confirmada e a licença é válida. Nesta versão de fábrica o build
              vem desligado.
            </Notice>
            <Toggle
              label="Capturar leads do Bolsão"
              description="Captura 1 lead, protege, alerta e pausa a captura até interação confirmada."
              checked={draft.autoClaimPool}
              onChange={(value) => patch('autoClaimPool', value)}
            />
            <Toggle
              label="Mover lead para atendimento"
              description="Move para a coluna configurada. Nunca fecha negócio, arquiva ou exclui."
              checked={draft.autoMoveToAttendance}
              onChange={(value) => patch('autoMoveToAttendance', value)}
            />
            <Toggle
              label="Criar atividade de follow-up"
              description="Cria uma atividade no C2S. Fica bloqueada até o contrato do modal ser calibrado."
              checked={draft.autoCreateFollowUp}
              onChange={(value) => patch('autoCreateFollowUp', value)}
            />
            <Toggle
              label="Enviar mensagem automática"
              description="Opt-in explícito. Usa o endpoint de resposta do C2S, nunca wa.me."
              checked={draft.autoSendMessage}
              onChange={(value) => patch('autoSendMessage', value)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Ritmo e resiliência</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Delay mínimo do Bolsão (ms)">
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={60_000}
                  value={draft.poolDelayMinMs}
                  onChange={(event) => patch('poolDelayMinMs', Number(event.target.value))}
                />
              </Field>
              <Field label="Delay máximo do Bolsão (ms)">
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={60_000}
                  value={draft.poolDelayMaxMs}
                  onChange={(event) => patch('poolDelayMaxMs', Number(event.target.value))}
                />
              </Field>
              <Field label="Polling (ms)" hint="Entre 2000 e 10000 ms, só com aba ativa.">
                <input
                  type="number"
                  className="input"
                  min={2_000}
                  max={10_000}
                  step={500}
                  value={draft.pollingIntervalMs}
                  onChange={(event) => patch('pollingIntervalMs', Number(event.target.value))}
                />
              </Field>
              <Field label="Máximo de tentativas">
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={10}
                  value={draft.maxRetries}
                  onChange={(event) => patch('maxRetries', Number(event.target.value))}
                />
              </Field>
              <Field label="Proteção contra duplicidade (h)">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={168}
                  value={draft.duplicateProtectionHours}
                  onChange={(event) => patch('duplicateProtectionHours', Number(event.target.value))}
                />
              </Field>
              <Field label="Follow-up após (h)">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={720}
                  value={draft.followUpDelayHours}
                  onChange={(event) => patch('followUpDelayHours', Number(event.target.value))}
                />
              </Field>
            </div>
            <Field label="Descrição do follow-up">
              <input
                className="input"
                value={draft.followUpDescription}
                onChange={(event) => patch('followUpDescription', event.target.value)}
                maxLength={200}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Destino no funil</h3>
            <p className="text-xs text-slate-500">
              Os IDs são coletados na calibração. Sem eles, nenhuma movimentação é permitida.
            </p>
            <Field label="ID do funil de atendimento">
              <input
                className="input"
                value={draft.targetAttendanceFunnelId}
                onChange={(event) => patch('targetAttendanceFunnelId', event.target.value)}
              />
            </Field>
            <Field label="ID da coluna de atendimento">
              <input
                className="input"
                value={draft.targetAttendanceColumnId}
                onChange={(event) => patch('targetAttendanceColumnId', event.target.value)}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Alertas</h3>
            <Toggle
              label="Notificações do desktop"
              description="Aviso local ao capturar ou perder um lead."
              checked={draft.desktopNotifications}
              onChange={(value) => patch('desktopNotifications', value)}
            />
            <Toggle
              label="Alerta sonoro"
              description="Som via documento offscreen, sem arquivo externo."
              checked={draft.soundAlerts}
              onChange={(value) => patch('soundAlerts', value)}
            />
            <Toggle
              label="Telemetria agregada"
              description="Desligada por padrão. Não envia PII nem conteúdo de conversa."
              checked={draft.telemetryEnabled}
              onChange={(value) => patch('telemetryEnabled', value)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Retenção de dados</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Logs técnicos (dias)">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={365}
                  value={draft.retentionTechnicalLogsDays}
                  onChange={(event) => patch('retentionTechnicalLogsDays', Number(event.target.value))}
                />
              </Field>
              <Field label="Dados de lead (dias)">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={730}
                  value={draft.retentionLeadDataDays}
                  onChange={(event) => patch('retentionLeadDataDays', Number(event.target.value))}
                />
              </Field>
              <Field label="Métricas (meses)">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={60}
                  value={draft.retentionMetricsMonths}
                  onChange={(event) => patch('retentionMetricsMonths', Number(event.target.value))}
                />
              </Field>
              <Field label="Screenshots (dias)">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={90}
                  value={draft.retentionScreenshotsDays}
                  onChange={(event) => patch('retentionScreenshotsDays', Number(event.target.value))}
                />
              </Field>
              <Field label="Máx. de screenshots">
                <input
                  type="number"
                  className="input"
                  min={10}
                  max={2_000}
                  value={draft.retentionScreenshotsMaxFiles}
                  onChange={(event) => patch('retentionScreenshotsMaxFiles', Number(event.target.value))}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Janela de interação</h3>
            <p className="text-xs text-slate-500">
              Todo lead ganha um prazo. O Bolsão é uma corrida curta; lead normal tem mais tempo. O prazo é contado a
              partir da chegada detectada na página.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Janela do Bolsão (min)" hint="Entre 1 e 30 minutos.">
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={30}
                  value={draft.poolWindowMinutes}
                  onChange={(event) => patch('poolWindowMinutes', Number(event.target.value))}
                />
              </Field>
              <Field label="Janela do lead normal (min)" hint="Entre 5 e 1440 minutos (24 h).">
                <input
                  type="number"
                  className="input"
                  min={5}
                  max={1_440}
                  value={draft.leadWindowMinutes}
                  onChange={(event) => patch('leadWindowMinutes', Number(event.target.value))}
                />
              </Field>
            </div>
            <Toggle
              label="Trazer a aba do C2S para frente ao agir"
              description="Ajuda o Chrome a não congelar a aba durante o clique. Volte para sua aba depois."
              checked={draft.bringTabToFront}
              onChange={(value) => patch('bringTabToFront', value)}
            />

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">Opt-in da automação</p>
                  <p className="text-xs text-slate-500">
                    {draft.automationOptInAt
                      ? `Registrado em ${new Date(draft.automationOptInAt).toLocaleString('pt-BR')}.`
                      : 'Não registrado — nenhuma ação automática é executada.'}
                  </p>
                </div>
                {draft.automationOptInAt ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      patch('automationOptInAt', '');
                      setAviso('Opt-in removido no rascunho. Clique em "Salvar alterações" para aplicar.');
                    }}
                  >
                    Revogar
                  </button>
                ) : (
                  <button type="button" className="btn-primary" onClick={() => setOptInOpen(true)}>
                    Registrar opt-in
                  </button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Mensagens padrão</h3>
            <Field label="Template para lead direto">
              <textarea
                className="input min-h-[90px]"
                value={draft.templateDirect}
                onChange={(event) => patch('templateDirect', event.target.value)}
                maxLength={4_000}
              />
            </Field>
            <Field label="Template para lead do Bolsão">
              <textarea
                className="input min-h-[90px]"
                value={draft.templatePool}
                onChange={(event) => patch('templatePool', event.target.value)}
                maxLength={4_000}
              />
            </Field>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={() => void salvar()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDraft(settings.data ?? draft);
              setAviso(null);
              setErro(null);
            }}
            disabled={saving}
          >
            Descartar mudanças
          </button>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (!window.confirm('Apagar todos os logs técnicos?')) return;
                void panelApi.clearData('logs').then(() => setAviso('Logs apagados.'));
              }}
            >
              Apagar logs
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (!window.confirm('Apagar TODOS os dados locais (leads, logs, métricas e amostras)? A licença e as configurações são mantidas.')) return;
                void panelApi.clearData('all').then(() => {
                  setAviso('Dados apagados.');
                  settings.refresh();
                });
              }}
            >
              Apagar todos os dados
            </button>
          </div>
        </CardBody>
      </Card>

      <Modal open={optInOpen} title="Registrar opt-in da automação" onClose={() => setOptInOpen(false)}>
        <div className="space-y-3 text-sm text-slate-700">
          <p>Você está autorizando a extensão a executar estas ações, e apenas quando todas as condições abaixo forem verdadeiras:</p>
          <ul className="list-inside list-disc space-y-1 text-xs text-slate-600">
            <li>build gerado com <code>VITE_AUTOMATION_ENABLED=true</code>;</li>
            <li>calibração confirmada e o modo inspeção desligado;</li>
            <li>licença válida e robô ativo.</li>
          </ul>
          <ul className="list-inside list-disc space-y-1 text-xs text-slate-600">
            <li>captura 1 lead do Bolsão e <strong>pausa o pool</strong> até interação confirmada;</li>
            <li>detecta e alerta leads normais; a escrita só ocorre se o contrato estiver calibrado;</li>
            <li>nunca arquiva, fecha negócio, exclui ou redistribui leads;</li>
            <li>nunca envia mensagem sem a opção específica de envio estar ligada.</li>
          </ul>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={optInAccepted}
              onChange={(event) => setOptInAccepted(event.target.checked)}
            />
            <span className="text-xs text-slate-600">
              Entendo o funcionamento e quero registrar o opt-in. Posso revogar nas configurações a qualquer momento.
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOptInOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!optInAccepted}
              onClick={() => {
                patch('automationOptInAt', new Date().toISOString());
                setOptInOpen(false);
                setOptInAccepted(false);
                setAviso('Opt-in adicionado ao rascunho. Clique em "Salvar alterações" para aplicar.');
              }}
            >
              Registrar opt-in
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
