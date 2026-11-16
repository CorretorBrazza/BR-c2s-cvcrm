import { useEffect, useState } from 'react';
import type { TemplateRecord, TemplateType } from '../../shared/types/template';
import { formatDateTimeBr } from '../../shared/utils/dateUtils';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { panelApi } from '../lib/panelApi';
import { Badge, Card, CardBody, EmptyState, ErrorBox, Field, Modal, Notice, SectionTitle, Spinner } from '../components/Ui';

const VARIAVEIS = ['{nome}', '{imovel}', '{telefone}', '{origem}', '{corretor}', '{imobiliaria}', '{data}'];

interface Draft {
  id?: string;
  nome: string;
  tipo: TemplateType;
  conteudo: string;
}

const EMPTY: Draft = { nome: '', tipo: 'DIRETO', conteudo: '' };

export function Templates(): JSX.Element {
  const templates = usePanelQuery<TemplateRecord[]>({ type: 'templates' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) setErro(null);
  }, [draft]);

  const salvar = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    setErro(null);
    try {
      await panelApi.saveTemplate({
        ...(draft.id ? { templateId: draft.id } : {}),
        nome: draft.nome.trim(),
        tipo: draft.tipo,
        conteudo: draft.conteudo,
      });
      setDraft(null);
      templates.refresh();
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remover = async (template: TemplateRecord): Promise<void> => {
    if (!window.confirm(`Remover o template "${template.nome}"?`)) return;
    try {
      await panelApi.deleteTemplate(template.id);
      templates.refresh();
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Falha ao remover.');
    }
  };

  const rows = templates.data ?? [];

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Templates de mensagem"
        description="Mensagens usadas apenas quando o envio automático estiver ligado (opt-in explícito). Nada é enviado nesta versão."
        actions={
          <button type="button" className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
            Novo template
          </button>
        }
      />

      <Notice tone="warn">
        O envio automático usa o endpoint de resposta do próprio C2S e fica desligado por padrão. Clique em WhatsApp
        nunca é considerado interação.
      </Notice>

      {templates.error ? <ErrorBox message={templates.error} /> : null}
      {erro ? <ErrorBox message={erro} /> : null}

      {templates.loading && !templates.data ? (
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Carregando templates…
            </div>
          </CardBody>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title="Nenhum template" description="Crie um modelo para padronizar o primeiro contato." />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((template) => (
            <Card key={template.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{template.nome}</h3>
                    <p className="text-[11px] text-slate-500">
                      Atualizado em {formatDateTimeBr(template.atualizadoEm)}
                    </p>
                  </div>
                  <Badge tone={template.tipo === 'BOLSAO' ? 'violet' : template.tipo === 'DIRETO' ? 'blue' : 'amber'}>
                    {template.tipo}
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
                  {template.conteudo}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">{template.variaveis.map((v) => `{${v}}`).join(' ')}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() =>
                        setDraft({
                          id: template.id,
                          nome: template.nome,
                          tipo: template.tipo,
                          conteudo: template.conteudo,
                        })
                      }
                    >
                      Editar
                    </button>
                    <button type="button" className="btn-danger" onClick={() => void remover(template)}>
                      Remover
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal open={draft !== null} title={draft?.id ? 'Editar template' : 'Novo template'} onClose={() => setDraft(null)}>
        {draft ? (
          <div className="space-y-3">
            <Field label="Nome">
              <input
                className="input"
                value={draft.nome}
                onChange={(event) => setDraft({ ...draft, nome: event.target.value })}
                maxLength={120}
              />
            </Field>
            <Field label="Tipo">
              <select
                className="input"
                value={draft.tipo}
                onChange={(event) => setDraft({ ...draft, tipo: event.target.value as TemplateType })}
              >
                <option value="DIRETO">Lead direto</option>
                <option value="BOLSAO">Bolsão</option>
                <option value="FOLLOWUP">Follow-up</option>
              </select>
            </Field>
            <Field label="Conteúdo" hint={`Variáveis: ${VARIAVEIS.join(' ')}`}>
              <textarea
                className="input min-h-[120px]"
                value={draft.conteudo}
                onChange={(event) => setDraft({ ...draft, conteudo: event.target.value })}
                maxLength={4_000}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)} disabled={saving}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void salvar()}
                disabled={saving || draft.nome.trim().length === 0 || draft.conteudo.trim().length === 0}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
