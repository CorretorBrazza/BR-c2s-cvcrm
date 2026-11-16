import { CVRM_ALVO, CVRM_ENTRADA, CVRM_LIMITS } from '../../shared/constants/cvcrm';
import {
  adminUrl,
  comMovimento,
  cvUrlInfo,
  elegiveisParaPainel,
  iniciarBaseline,
  mergeKanban,
  movimentoEncerrado,
  selectElegivel,
  timingFrom,
} from '../../shared/analysis/cvcrmPolicy';
import type {
  CvExecResult,
  CvKanbanLead,
  CvMove,
  CvMoveState,
  CvOverview,
} from '../../shared/types/cvcrm';
import type { Settings } from '../../shared/types/settings';
import { nowIso } from '../../shared/utils/dateUtils';
import { newId } from '../../shared/utils/idGenerator';
import { broadcastToPanel } from '../events/eventBus';
import { logEvent } from '../events/logEvent';
import { requestTab, tabRegistry } from '../messaging/tabs';
import { notificationService } from '../notifications/notificationService';
import { settingsRepository } from '../storage/repositories/settingsRepository';
import { motivosCvcrm, requisitosCvcrm } from './cvcrmGate';
import { cvcrmState } from './cvcrmState';

/**
 * Motor do CV CRM: detecta lead novo na coluna de entrada e move a etapa.
 *
 * O motor nunca escreve no CRM. Ele abre a aba do lead e pede ao content script
 * o clique no `<a>` nativo de `modificarSituacao('4', ...)`. A prova de sucesso
 * é a própria página recarregada com `.status.ativo` = 4.
 *
 * Falhar fechado é a regra: qualquer dúvida gera `FALHA`/`BLOQUEADO`, aviso ao
 * corretor e nenhuma nova tentativa para aquele lead.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CvcrmEngine {
  private rodando = false;
  private pendenteTick = false;
  private leads: CvKanbanLead[] = [];
  private agendado: ReturnType<typeof setTimeout> | null = null;

  /** Dispara um tick; nunca empilha execução concorrente. */
  tick(): void {
    if (this.rodando) {
      this.pendenteTick = true;
      return;
    }
    this.rodando = true;
    void this.executarTick()
      .catch(async (error: unknown) => {
        await logEvent({
          tipoEvento: 'INTERNAL_ERROR',
          nivel: 'ERRO',
          origem: 'SISTEMA',
          motivo: `Falha no tick do CV CRM: ${error instanceof Error ? error.message : 'desconhecida'}`,
        });
      })
      .finally(() => {
        this.rodando = false;
        if (this.pendenteTick) {
          this.pendenteTick = false;
          this.tick();
        }
      });
  }

  async overview(): Promise<CvOverview> {
    const settings = await settingsRepository.get();
    const state = await cvcrmState.load();
    const timing = timingFrom(settings.cvcrmDelaySeconds, settings.cvcrmMaxAgeHours);
    const requisitos = requisitosCvcrm(settings, state);
    const motivos = requisitos.filter((requisito) => !requisito.ok).map((requisito) => requisito.motivo ?? requisito.label);

    return {
      ativo: settings.cvcrmEnabled,
      modulo: settings.cvcrmEnabled,
      mover: settings.cvcrmAutoMove,
      automacao: motivos.length === 0,
      motivos,
      requisitos,
      baselineEm: state.baselineEm,
      pendente: state.pendente,
      movimentos: state.movimentos.slice(0, 20),
      elegiveis: elegiveisParaPainel(state, this.leads, Date.now(), timing),
      conhecidos: Object.keys(state.ultimaEtapa).length,
      ignorados: state.baselineIds.length,
      ...(state.ultimoTickEm ? { ultimoTickEm: state.ultimoTickEm } : {}),
      kanbanAberto: this.acharKanban() !== null,
      deteccao: settings.cvcrmDetection,
      host: settings.cvcrmHost,
      atrasoSeconds: settings.cvcrmDelaySeconds,
      idadeMaxHoras: settings.cvcrmMaxAgeHours,
      pollSeconds: settings.cvcrmPollSeconds,
    };
  }

  /* --------------------------- eventos do content ------------------- */

  /**
   * Relato de página do CV CRM. É o oráculo de confirmação: quando a aba do
   * lead recarrega com a etapa 4, o movimento está provado.
   */
  async onPageReport(
    tabId: number,
    payload: { url: string; leadId?: string; atual?: number },
  ): Promise<void> {
    const info = cvUrlInfo(payload.url);
    if (info.host) await this.aprenderHost(info.host);

    const state = await cvcrmState.load();
    const pendente = state.pendente;
    if (!pendente) return;
    if (pendente.tabId !== undefined && pendente.tabId !== tabId) return;

    // Aba do lead caiu no login: a sessão do CRM expirou. Falha rápida e
    // explícita, em vez de esperar 25 s por uma página que nunca vai carregar.
    if (info.context === 'LOGIN') {
      await this.finalizar(pendente, 'BLOQUEADO', 'SESSAO_DO_CV_CRM_EXPIRADA');
      return;
    }

    if (!payload.leadId || payload.leadId !== pendente.leadId) return;

    // O content script lê a etapa no `document_end` (página server-rendered).
    // Só a etapa 4 encerra o movimento; qualquer outro valor segue aguardando.
    if (payload.atual === CVRM_ALVO) await this.finalizar(pendente, 'CONFIRMADO');
  }

  /** Leitura do kanban: atualiza a lista de leads conhecidos. */
  async onKanban(payload: { leads: CvKanbanLead[]; toasts?: string[] }): Promise<void> {
    const agoraIso = nowIso();
    const leads = [...payload.leads];

    // Lead anunciado em toast entra na lista como "na entrada": a página do
    // lead confirma (ou não) antes de qualquer clique.
    for (const leadId of payload.toasts ?? []) {
      if (leads.some((lead) => lead.leadId === leadId)) continue;
      leads.push({ leadId, etapa: CVRM_ENTRADA, diasNaSituacao: 0, criadoDias: null });
    }

    this.leads = leads;

    const settings = await settingsRepository.get();
    const state = await cvcrmState.load();
    await cvcrmState.update((atual) => mergeKanban(atual, leads, agoraIso));

    if (payload.toasts?.length) {
      await cvcrmState.update((atual) => ({ ...atual, ultimoToastEm: agoraIso }));
      for (const leadId of payload.toasts.slice(0, 10)) {
        await logEvent({
          tipoEvento: 'CVRM_LEAD_DETECTED',
          nivel: 'INFO',
          origem: 'PAGINA',
          leadId,
          resultado: 'TOAST',
          motivo: 'O próprio CRM anunciou um lead novo.',
        });
      }
      if (state.baselineEm && settings.cvcrmEnabled) {
        this.agendar(settings.cvcrmDelaySeconds * 1_000);
      }
    }
  }

  async onTabRemoved(tabId: number): Promise<void> {
    const state = await cvcrmState.load();
    const pendente = state.pendente;
    if (!pendente || pendente.tabId !== tabId) return;
    await this.finalizar(pendente, 'FALHA', 'ABA_FECHADA');
  }

  /* ------------------------------ ações ----------------------------- */

  /** Marca a linha de base: tudo que está na entrada agora nunca é movido. */
  async definirBaseline(): Promise<CvOverview> {
    const kanban = this.acharKanban();
    if (!kanban) throw new Error('Abra o kanban do CV CRM numa aba para definir a linha de base.');

    const leads = await this.lerKanban(kanban.tabId);
    if (!leads) throw new Error('O kanban do CV CRM não respondeu à leitura.');

    const agoraIso = nowIso();
    const state = await cvcrmState.update((atual) => iniciarBaseline(atual, leads, agoraIso));
    this.leads = leads;

    await logEvent({
      tipoEvento: 'CVRM_BASELINE_SET',
      nivel: 'INFO',
      origem: 'PAINEL',
      resultado: `${state.baselineIds.length} lead(s) na entrada`,
      motivo: 'Linha de base definida: esses leads não serão movidos.',
    });
    await this.refreshPanel();
    return this.overview();
  }

  async limpar(): Promise<void> {
    await cvcrmState.reset();
    this.leads = [];
    await this.refreshPanel();
  }

  /* ------------------------------ tick ------------------------------ */

  private async executarTick(): Promise<void> {
    const settings = await settingsRepository.get();
    if (!settings.cvcrmEnabled) return;

    let state = await cvcrmState.load();
    const agora = Date.now();

    // Pendente vencido: fechou sem provar a etapa. Um movimento ainda ARMADO
    // tem concessão maior, porque o motor está no meio do atraso/carregamento.
    if (state.pendente) {
      const desde = new Date(state.pendente.atualizadoEm).getTime();
      const limite =
        state.pendente.estado === 'CLICADO'
          ? CVRM_LIMITS.confirmTimeoutMs
          : CVRM_LIMITS.armLeaseMs;
      if (Number.isFinite(desde) && agora - desde > limite) {
        await this.finalizar(
          state.pendente,
          'FALHA',
          state.pendente.estado === 'CLICADO'
            ? 'SEM_CONFIRMACAO_DE_ETAPA'
            : 'MOVIMENTO_ABANDONADO',
        );
        state = await cvcrmState.load();
      }
    }

    const kanban = this.acharKanban();
    if (kanban) {
      const leads = await this.lerKanban(kanban.tabId);
      if (leads) {
        this.leads = leads;
        const agoraIso = nowIso();
        state = await cvcrmState.update((atual) => mergeKanban(atual, leads, agoraIso));
      }
    }

    if (motivosCvcrm(settings, state).length > 0) return;
    if (state.pendente) return;

    const timing = timingFrom(settings.cvcrmDelaySeconds, settings.cvcrmMaxAgeHours);
    const alvo = selectElegivel(state, this.leads, Date.now(), timing);
    if (!alvo) return;

    await this.mover(alvo.leadId, settings, kanban?.url ?? '');
  }

  private async mover(leadId: string, settings: Settings, urlKanban: string): Promise<void> {
    const host = settings.cvcrmHost || cvUrlInfo(urlKanban).host;
    if (!host) {
      await logEvent({
        tipoEvento: 'CVRM_MOVE_BLOCKED',
        nivel: 'AVISO',
        origem: 'SISTEMA',
        leadId,
        motivo: 'Tenant do CV CRM desconhecido.',
      });
      return;
    }

    const url = adminUrl(host, leadId);
    const agoraIso = nowIso();

    let tabId: number | undefined;
    try {
      const aba = await chrome.tabs.create({ url, active: false });
      tabId = aba.id;
    } catch {
      tabId = undefined;
    }

    const movimento: CvMove = {
      id: newId('cvm'),
      leadId,
      estado: 'ARMADO',
      criadoEm: agoraIso,
      atualizadoEm: agoraIso,
      de: CVRM_ENTRADA,
      para: CVRM_ALVO,
      ...(tabId !== undefined ? { tabId } : {}),
    };
    await cvcrmState.update((atual) => comMovimento(atual, movimento));

    await logEvent({
      tipoEvento: 'CVRM_MOVE_STARTED',
      nivel: 'INFO',
      origem: 'SISTEMA',
      leadId,
      endpoint: `/corretor/comercial/leads/${leadId}/administrar`,
      metodoHttp: 'GET',
      resultado: 'ABRINDO_ABA',
      motivo: 'Lead novo na coluna de entrada.',
    });

    if (tabId === undefined) {
      await this.finalizar(movimento, 'FALHA', 'ABA_NAO_ABRIU');
      return;
    }

    // Atraso aprovado: o lead "assenta" no CRM antes de sair da coluna.
    await sleep(Math.max(0, settings.cvcrmDelaySeconds) * 1_000);

    // A aba pode já ter resolvido o movimento durante a espera (login expirado,
    // etapa já alterada por outra pessoa). Nesse caso não há o que executar.
    const depoisDaEspera = await cvcrmState.load();
    if (!depoisDaEspera.pendente || depoisDaEspera.pendente.id !== movimento.id) return;

    const resultado = await this.executarNaAba(tabId, leadId, settings.inspectMode);
    if (!resultado) {
      await this.finalizar(movimento, 'FALHA', 'ABA_NAO_RESPONDEU');
      return;
    }
    if (!resultado.ok) {
      await this.finalizar(movimento, 'BLOQUEADO', resultado.motivo);
      return;
    }
    if (resultado.acao === 'NENHUMA') {
      // Já estava no alvo: idempotente, nada a escrever no CRM.
      await this.finalizar(movimento, 'CONFIRMADO');
      return;
    }

    const clicado: CvMove = { ...movimento, estado: 'CLICADO', atualizadoEm: nowIso() };
    await cvcrmState.update((atual) => comMovimento(atual, clicado));
    await this.refreshPanel();
  }

  /**
   * Pede ao content script o clique. Reenvia enquanto a página do lead não
   * estiver pronta (o content script só existe depois do `document_end`).
   */
  private async executarNaAba(
    tabId: number,
    leadId: string,
    inspectMode: boolean,
  ): Promise<CvExecResult | null> {
    const limite = Date.now() + CVRM_LIMITS.pageLoadTimeoutMs;

    while (Date.now() < limite) {
      const resposta = await requestTab<CvExecResult>(tabId, {
        kind: 'cvcrm:executar',
        id: 'sw',
        payload: { leadId, inspectMode },
      });
      if (resposta?.ok) return resposta.data;
      if (resposta && !resposta.ok) {
        return { ok: false, motivo: resposta.error || 'EXECUCAO_RECUSADA', acao: 'NENHUMA' };
      }
      await sleep(700);
    }
    return null;
  }

  private async lerKanban(tabId: number): Promise<CvKanbanLead[] | null> {
    const resposta = await requestTab<CvKanbanLead[]>(
      tabId,
      { kind: 'cvcrm:scan', id: 'sw', payload: {} },
      10_000,
    );
    return resposta?.ok ? resposta.data : null;
  }

  private agendar(atrasoMs: number): void {
    if (this.agendado !== null) return;
    this.agendado = setTimeout(() => {
      this.agendado = null;
      this.tick();
    }, Math.max(200, atrasoMs));
  }

  /* ---------------------------- finalização ------------------------- */

  private async finalizar(
    movimento: CvMove,
    estado: CvMoveState,
    motivo?: string,
  ): Promise<void> {
    // Idempotente: quem chega depois não reescreve o resultado nem repete o aviso.
    const antes = await cvcrmState.load();
    if (movimentoEncerrado(antes.movimentos.find((item) => item.id === movimento.id))) return;

    const atualizado: CvMove = {
      ...movimento,
      estado,
      atualizadoEm: nowIso(),
      ...(motivo ? { motivo } : {}),
    };
    await cvcrmState.update((atual) => comMovimento(atual, atualizado));
    await this.fecharAba(movimento.tabId);

    const confirmado = estado === 'CONFIRMADO';
    await logEvent({
      tipoEvento: confirmado
        ? 'CVRM_MOVE_CONFIRMED'
        : estado === 'BLOQUEADO'
          ? 'CVRM_MOVE_BLOCKED'
          : 'CVRM_MOVE_FAILED',
      nivel: confirmado ? 'INFO' : 'AVISO',
      origem: 'SISTEMA',
      leadId: movimento.leadId,
      resultado: estado,
      ...(motivo ? { motivo } : {}),
    });

    const settings = await settingsRepository.get();
    if (settings.desktopNotifications) {
      await notificationService.notify({
        title: confirmado ? 'CV CRM: etapa alterada' : 'CV CRM: não deu para mover',
        message: confirmado
          ? `Lead #${movimento.leadId} agora está em "Em Atendimento".`
          : `Lead #${movimento.leadId} continua na entrada (${motivo ?? estado}).`,
        priority: confirmado ? 1 : 2,
        sound: settings.soundAlerts,
      });
    }

    await this.refreshPanel();
  }

  private async fecharAba(tabId?: number): Promise<void> {
    if (tabId === undefined) return;
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* aba já fechada */
    }
  }

  private async aprenderHost(host: string): Promise<void> {
    const settings = await settingsRepository.get();
    if (settings.cvcrmHost === host) return;
    await settingsRepository.patch({ cvcrmHost: host });
  }

  private acharKanban(): { tabId: number; url: string } | null {
    const abas = tabRegistry
      .list()
      .filter((aba) => cvUrlInfo(aba.url).context === 'KANBAN')
      .sort((a, b) => (a.url < b.url ? -1 : 1));
    const primeira = abas[0];
    return primeira ? { tabId: primeira.tabId, url: primeira.url } : null;
  }

  private async refreshPanel(): Promise<void> {
    const settings = await settingsRepository.get();
    await broadcastToPanel({
      type: 'status',
      payload: {
        status: 'CVRM_ATUALIZADO',
        botActive: settings.botActive,
        inspectMode: settings.inspectMode,
        conectado: this.acharKanban() !== null,
        atualizadoEm: nowIso(),
      },
    });
  }
}

export const cvcrmEngine = new CvcrmEngine();
