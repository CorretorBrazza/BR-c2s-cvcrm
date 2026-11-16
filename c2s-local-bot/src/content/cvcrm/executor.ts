import { decidirMovimento } from '../../shared/analysis/cvcrmPolicy';
import type { CvExecResult } from '../../shared/types/cvcrm';
import { findAnchor, readPanel } from './panelReader';
import { ARM_EVENT } from './confirmGuard';

/**
 * Executor da mudança de etapa.
 *
 * Não monta requisição, não usa `fetch`, não chama `submit()`. A única ação é o
 * clique no `<a>` nativo — o mesmo que o corretor clica — com o `confirm`
 * daquele lead armado. Todo o transporte (incluindo `post[...]` e o `tk` de 128
 * hex) fica por conta da própria página.
 */
export interface ExecutarOptions {
  /**
   * Como disparar o clique. O content script responde ao service worker ANTES
   * de clicar (evita perder a resposta quando a página navega); nos testes o
   * padrão síncrono mantém o caminho idêntico.
   */
  agendar?: (acao: () => void) => void;
  /** URL da aba (nos testes o jsdom não navega). Padrão: `win.location.href`. */
  url?: string;
}

export function executarMovimento(
  doc: Document,
  win: Window,
  leadIdEsperado: string,
  opcoes: ExecutarOptions = {},
): CvExecResult {
  const leitura = readPanel(doc, opcoes.url ?? win.location.href);
  const decisao = decidirMovimento(leitura);
  const etapaAntes = leitura.atual ?? undefined;

  if (decisao.kind === 'NOOP') {
    return { ok: true, motivo: decisao.motivo, acao: 'NENHUMA', ...(etapaAntes !== undefined ? { etapaAntes } : {}) };
  }

  if (decisao.kind === 'BLOQUEADO') {
    return { ok: false, motivo: decisao.motivo, acao: 'NENHUMA', ...(etapaAntes !== undefined ? { etapaAntes } : {}) };
  }

  if (decisao.leadId !== leadIdEsperado) {
    return {
      ok: false,
      motivo: 'LEAD_DIVERGENTE',
      acao: 'NENHUMA',
      ...(etapaAntes !== undefined ? { etapaAntes } : {}),
    };
  }

  const ancora = findAnchor(doc, decisao.para);
  if (!ancora) {
    return { ok: false, motivo: 'ALVO_INDISPONIVEL', acao: 'NENHUMA', etapaAntes: decisao.de };
  }

  // Arma exatamente um `confirm` — o do lead que estamos movendo.
  win.dispatchEvent(
    new CustomEvent(ARM_EVENT, { detail: JSON.stringify({ leadId: decisao.leadId }) }),
  );

  const clicar = (): void => ancora.click();
  const agendar = opcoes.agendar;
  if (agendar) agendar(clicar);
  else clicar();

  return { ok: true, motivo: 'CLIQUE_ENVIADO', acao: 'CLIQUE', etapaAntes: decisao.de };
}
