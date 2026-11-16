import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { APP_NAME, APP_VERSION, PANEL_NAV } from '../../shared/constants/defaults';
import type { Settings } from '../../shared/types/settings';
import type { CvOverview } from '../../shared/types/cvcrm';
import { panelApi } from '../lib/panelApi';
import { usePanelQuery } from '../hooks/usePanelQuery';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { Badge, Notice, Spinner } from './Ui';

interface LayoutProps {
  route: string;
  navigate: (path: string) => void;
  children: ReactNode;
}

/**
 * Casca do painel.
 *
 * A navegação é dividida por produto — C2S e CV CRM têm o **mesmo peso** — e o
 * rodapé mostra o estado dos dois separadamente. O que é comum (robô, licença,
 * inspeção) fica no cabeçalho e em "Sistema".
 */
export function Layout({ route, navigate, children }: LayoutProps): JSX.Element {
  const settings = usePanelQuery<Settings>({ type: 'settings' });
  const connection = usePanelQuery<{ conectado: boolean; abaC2sAberta: boolean; ultimoPingEm?: string }>(
    { type: 'connection' },
    { autoRefreshMs: 15_000 },
  );
  const cvcrm = usePanelQuery<CvOverview>({ type: 'cvcrm' }, { autoRefreshMs: 15_000 });
  const live = useLiveEvents(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleBot = useCallback(async () => {
    const current = settings.data?.botActive ?? true;
    setBusy(true);
    try {
      await panelApi.toggleBot(!current);
      settings.refresh();
      setNotice(!current ? 'Robô ativado.' : 'Robô pausado.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao alterar o robô.');
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const toggleInspection = useCallback(async () => {
    const current = settings.data?.inspectMode ?? true;
    setBusy(true);
    try {
      await panelApi.setInspection(!current);
      settings.refresh();
      setNotice(!current ? 'Modo inspeção ligado.' : 'Modo inspeção desligado.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao alterar a inspeção.');
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const openSidePanel = useCallback(async () => {
    try {
      const sidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
        open: (options: { windowId: number }) => Promise<void>;
      };
      const current = await chrome.windows.getCurrent();
      if (current.id === undefined) throw new Error('Janela atual não identificada.');
      await sidePanel.open({ windowId: current.id });
    } catch {
      setNotice('Painel lateral indisponível neste contexto. Use esta aba.');
    }
  }, []);

  const conectado = connection.data?.conectado ?? false;
  const botActive = settings.data?.botActive ?? true;
  const inspectMode = settings.data?.inspectMode ?? true;

  const cv = cvcrm.data;
  const cvLigado = cv?.modulo ?? false;
  const cvMover = cv?.mover ?? false;
  const cvLivre = cv?.automacao ?? false;
  const cvPendentes = cv?.requisitos.filter((requisito) => !requisito.ok) ?? [];
  const cvDica = cv
    ? cvPendentes.length === 0
      ? 'Automação liberada.'
      : `Falta: ${cvPendentes.map((requisito) => requisito.label).join(' · ')}`
    : 'Estado do CV CRM ainda não carregado.';

  const c2sTone = conectado ? (botActive ? 'green' : 'slate') : 'amber';
  const c2sTexto = !botActive ? 'Pausado' : conectado ? 'Conectado' : 'Aguardando';
  const cvTone = !cvLigado ? 'slate' : cvMover ? (cvLivre ? 'green' : 'amber') : 'blue';
  const cvTexto = !cvLigado
    ? 'Desligado'
    : cvMover
      ? cvLivre
        ? 'Movendo'
        : `Bloqueado${cvPendentes.length > 0 ? ` · ${cvPendentes.length}` : ''}`
      : 'Observando';

  return (
    <div className="flex h-full min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
            ⚡
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-slate-900">{APP_NAME}</p>
            <p className="text-[11px] text-slate-500">Local-first · v{APP_VERSION}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {PANEL_NAV.map((grupo, index) => (
            <div key={`${grupo.grupo}-${index}`} className="space-y-1">
              {grupo.grupo ? (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {grupo.grupo}
                </p>
              ) : null}
              {grupo.itens.map((item) => {
                const active = route === item.path;
                const doCv = grupo.grupo === 'CV CRM';
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                      active
                        ? doCv
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-brand-50 text-brand-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        active ? (doCv ? 'bg-amber-500' : 'bg-brand-600') : 'bg-transparent'
                      }`}
                      aria-hidden
                    />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t border-slate-200 p-3 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700">C2S</span>
            <Badge tone={c2sTone}>{c2sTexto}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700">CV CRM</span>
            <span title={cvDica} className="cursor-help">
              <Badge tone={cvTone}>{cvTexto}</Badge>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Inspeção</span>
            {inspectMode ? <Badge tone="violet">ativa</Badge> : <Badge>inativa</Badge>}
          </div>
          <button type="button" className="btn-secondary w-full" onClick={openSidePanel}>
            Abrir painel lateral
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <Badge tone={botActive ? 'green' : 'slate'}>{botActive ? 'Ativo' : 'Pausado'}</Badge>
            {live.status?.status ? <Badge tone="blue">{live.status.status}</Badge> : null}
            {busy ? <Spinner /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={botActive ? 'btn-secondary' : 'btn-primary'}
              onClick={() => void toggleBot()}
              disabled={busy}
            >
              {botActive ? 'Pausar robô' : 'Retomar robô'}
            </button>
            <button
              type="button"
              className={inspectMode ? 'btn-secondary' : 'btn-primary'}
              onClick={() => void toggleInspection()}
              disabled={busy}
            >
              {inspectMode ? 'Encerrar inspeção' : 'Iniciar inspeção'}
            </button>
          </div>
        </header>

        {notice ? (
          <div className="px-6 pt-4">
            <Notice tone="info">{notice}</Notice>
          </div>
        ) : null}

        <main className="flex-1 overflow-auto px-6 py-5">{children}</main>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-6 py-2 text-[11px] text-slate-500">
          <span>
            {APP_NAME} v{APP_VERSION} · C2S e CV CRM no mesmo robô · dados somente neste navegador.
          </span>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              C2S <Badge tone={c2sTone}>{c2sTexto}</Badge>
            </span>
            <span className="flex items-center gap-1">
              CV CRM <Badge tone={cvTone}>{cvTexto}</Badge>
            </span>
          </span>
        </footer>
      </div>
    </div>
  );
}
