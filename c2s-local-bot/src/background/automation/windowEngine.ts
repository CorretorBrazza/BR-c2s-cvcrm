import {
  WINDOW_LIMITS,
  backoffFor,
  deadlineWithTimer,
  isExpired,
  poolPaused,
  selectNext,
  shouldCreateWindow,
  statsOf,
} from '../../shared/analysis/windowPolicy';
import { APP_NAME } from '../../shared/constants/defaults';
import { FEATURE_FLAGS } from '../../shared/constants/featureFlags';
import type { Settings } from '../../shared/types/settings';
import type {
  LeadWindow,
  WindowActionResult,
  WindowCandidate,
  WindowInteractionEvidence,
  WindowProbeResult,
  WindowsOverview,
  WindowTickMeta,
  WindowTiming,
} from '../../shared/types/window';
import type { SelectorAuditReport } from '../../shared/types/audit';
import { nowIso } from '../../shared/utils/dateUtils';
import { broadcastToPanel } from '../events/eventBus';
import { logEvent } from '../events/logEvent';
import { requestTab, tabRegistry } from '../messaging/tabs';
import { metricsService } from '../metrics/metricsService';
import { notificationService } from '../notifications/notificationService';
import { sessionService } from '../session/sessionService';
import { storageGet, storageSet } from '../storage/chromeStorage';
import { leadRepository } from '../storage/repositories/leadRepository';
import { settingsRepository } from '../storage/repositories/settingsRepository';
import { windowRepository } from '../storage/repositories/windowRepository';
import { automacaoLiberada, gateForAction, motivosDeBloqueio } from './automationGate';

const TICK_KEY = 'windows:tick';
const SEEN_NORMAL_KEY = 'windows:seen_normal';
const SEEN_TTL_MS = 7 * 86_400_000;
const MAX_SEEN = 1_000;
const ACTIVITY_CONTRACT_REASON =
  'Criação de atividade ainda não calibrada: falta uma amostra manual do modal/POST do C2S.';
/** Ticks consecutivos com badge do Bolsão > 0 e zero cards lidos. */
const SELECTOR_SUSPEITO_TICKS = 3;

interface SeenNormal {
  ids: Record<string, string>;
  atualizadoEm: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidateTime(value: string | undefined, now: number): string {
  if (!value) return new Date(now).toISOString();
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return new Date(now).toISOString();
  // Datas absurdas (passado distante/futuro) são descartadas: o prazo precisa
  // refletir a chegada real, não um parser confuso.
  if (parsed > now + 60_000 || parsed < now - 30 * 86_400_000) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}

function timingOf(settings: Settings): WindowTiming {
  return { poolMinutes: settings.poolWindowMinutes, leadMinutes: settings.leadWindowMinutes };
}

class WindowEngine {
  private running = false;
  private pending = false;
  /** Abas em que já pedimos ao Chrome para não descartar por falta de memória. */
  private readonly protectedTabs = new Set<number>();
  /** Watchdog de layout: ticks seguidos com Bolsão "cheio" e parser vazio. */
  private poolVazioSeguidos = 0;
  private seletorSuspeitoAvisado = false;

  /** Dispara um tick; nunca empilha execução concorrente. */
  tick(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    void this.runTick()
      .catch(async (error: unknown) => {
        await logEvent({
          tipoEvento: 'INTERNAL_ERROR',
          nivel: 'ERRO',
          origem: 'SISTEMA',
          motivo: `Falha no tick de janelas: ${error instanceof Error ? error.message : 'desconhecida'}`,
        });
      })
      .finally(() => {
        this.running = false;
        if (this.pending) {
          this.pending = false;
          this.tick();
        }
      });
  }

  async overview(): Promise<WindowsOverview> {
    const [janelas, settings, meta] = await Promise.all([
      windowRepository.all(),
      settingsRepository.get(),
      storageGet<WindowTickMeta>(TICK_KEY),
    ]);
    return {
      janelas,
      stats: statsOf(janelas),
      poolPausado: poolPaused(janelas),
      ...(meta?.ultimoTickEm ? { ultimoTickEm: meta.ultimoTickEm } : {}),
      abaRespondeu: meta?.abaRespondeu ?? false,
      automacaoLiberada: automacaoLiberada(settings),
      motivosBloqueio: motivosDeBloqueio(settings),
      avisos: meta?.avisos ?? [],
    };
  }

  /**
   * Auditoria de seletores na aba atual do C2S.
   * Somente leitura: serve para descobrir um layout novo antes de o bot agir
   * com o layout antigo.
   */
  async audit(): Promise<SelectorAuditReport> {
    const tab = this.pickTab();
    if (!tab) throw new Error('Abra o C2S no Chrome para auditar os seletores.');
    const response = await requestTab<SelectorAuditReport>(tab.tabId, {
      kind: 'window:audit',
      id: 'sw',
      payload: {},
    });
    if (!response) throw new Error('A aba do C2S não respondeu à auditoria.');
    if (!response.ok) throw new Error(response.error || 'Falha ao auditar os seletores.');
    return response.data;
  }

  /**
   * Encerra uma janela protegida por evidência de interação. Só `super_reply`
   * (resposta enviada pelo C2S) ou confirmação manual do corretor contam —
   * clique em WhatsApp nunca chega aqui.
   */
  async confirmInteraction(
    c2sLeadId: string,
    evidencia: WindowInteractionEvidence,
  ): Promise<boolean> {
    const janelas = await windowRepository.all();
    const alvo = janelas.filter(
      (window) => window.c2sLeadId === c2sLeadId && window.estado === 'ACAO_EXECUTADA',
    );
    if (alvo.length === 0) return false;

    const agora = nowIso();
    for (const window of alvo) {
      await windowRepository.patch(window.id, {
        estado: 'INTERACAO_CONFIRMADA',
        interacaoConfirmadaEm: agora,
        bloqueio: undefined,
        bloqueioRetentavel: undefined,
        proximaTentativaEm: undefined,
      });
      await logEvent({
        tipoEvento: 'INTERACTION_CONFIRMED',
        nivel: 'INFO',
        origem: evidencia === 'MANUAL' ? 'PAINEL' : 'PAGINA',
        resultado: evidencia,
        c2sLeadId,
        motivo:
          evidencia === 'MANUAL'
            ? 'Corretor confirmou manualmente que interagiu com o lead.'
            : 'Resposta enviada pelo C2S detectada (super_reply).',
      });
      await this.updateLead(c2sLeadId, 'EM_ATENDIMENTO', 'PROTEGIDO');
    }

    await this.alert(
      {
        title: `${APP_NAME}: interação confirmada`,
        message: 'Bolsão liberado para uma nova captura.',
      },
      true,
    );
    await this.refreshPanel();
    return true;
  }

  async clear(scope: 'terminal' | 'all'): Promise<number> {
    if (scope === 'all') {
      const removed = await windowRepository.clearAll();
      await storageSet(TICK_KEY, null);
      // Limpar o baseline força a próxima lista a ser lida como referência:
      // nada de criar janela para lead antigo depois de zerar.
      await storageSet(SEEN_NORMAL_KEY, null);
      await this.refreshPanel();
      return removed;
    }
    const settings = await settingsRepository.get();
    const removed = await windowRepository.clearTerminal(
      Math.min(settings.retentionLeadDataDays, 30),
    );
    await this.refreshPanel();
    return removed;
  }

  /* ----------------------------- tick ------------------------------- */

  private async runTick(): Promise<void> {
    const now = Date.now();
    const settings = await settingsRepository.get();
    let janelas = await windowRepository.all();

    const previous = await storageGet<WindowTickMeta>(TICK_KEY);
    if (previous?.ultimoTickEm) {
      const gap = now - new Date(previous.ultimoTickEm).getTime();
      if (Number.isFinite(gap) && gap > WINDOW_LIMITS.suspensaoMs) {
        await logEvent({
          tipoEvento: 'SUSPENSION_DETECTED',
          nivel: 'AVISO',
          origem: 'SISTEMA',
          resultado: 'retomada',
          motivo: `${Math.round(gap / 60_000)} min sem tick (máquina suspensa ou navegador hibernado). Nada foi executado durante o intervalo.`,
        });
        // Nunca agir em DOM velho: as janelas só voltam a ser elegíveis depois
        // do probe novo feito logo abaixo.
      }
    }

    janelas = await this.expire(janelas, settings);

    const tab = this.pickTab();
    if (tab) await this.protectTab(tab.tabId);
    const probeResponse = tab
      ? await requestTab<WindowProbeResult>(tab.tabId, {
          kind: 'window:probe',
          id: 'sw',
          payload: {},
        })
      : null;

    const probe = probeResponse?.ok ? probeResponse.data : null;
    const abaRespondeu = probe !== null;
    const avisos: string[] = [];

    if (probe) {
      const pause = poolPaused(janelas);
      const poolUtilizavel =
        probe.bucketVisivel && !probe.freeTier && !probe.bolsaoPausado && !pause.pausado;

      if (poolUtilizavel) {
        janelas = await this.absorbPool(probe, janelas, settings);
      }
      await this.checkSelectorWatchdog(probe);
      if (probe.contexto === 'CONTACTS_LIST' && probe.listaNormalVisivel) {
        janelas = await this.absorbNormal(probe, janelas, settings);
      }
      janelas = await this.expire(janelas, settings);

      avisos.push(...probe.observacoes);
      if (!probe.bucketVisivel && janelas.some((window) => window.origem === 'POOL')) {
        avisos.push(
          'A aba do C2S não está no Bolsão: captura do pool fica bloqueada até você abrir a página.',
        );
      }
    } else {
      avisos.push('A aba do C2S não respondeu ao último tick (fechada, congelada ou descarregada).');
    }

    if (!FEATURE_FLAGS.activityAutomationEnabled) {
      avisos.push(ACTIVITY_CONTRACT_REASON);
      janelas = await this.blockActivityWindows(janelas);
    }

    const motivos = motivosDeBloqueio(settings);
    const liberado = motivos.length === 0;

    if (probe && liberado) {
      await this.actNext(janelas, probe, settings);
    }

    await this.persistMeta(
      {
        ultimoTickEm: nowIso(),
        abaRespondeu,
        motivosBloqueio: motivos,
        avisos: Array.from(new Set(avisos)).slice(0, 12),
        poolPausado: poolPaused(janelas),
      },
      settings,
    );
  }

  /* --------------------------- detecção ----------------------------- */

  /**
   * Watchdog de layout do Bolsão.
   *
   * O badge do C2S é a única testemunha independente do parser. Se ele diz que
   * há leads e o DOM não rende card nenhum por vários ticks, o mais provável é
   * mudança de markup — e insistir seria pior que avisar. Nunca age aqui: só
   * registra e notifica uma vez por episódio.
   */
  private async checkSelectorWatchdog(probe: WindowProbeResult): Promise<void> {
    const indicado = probe.bolsaoIndicado ?? 0;
    const suspeito = probe.bucketVisivel && indicado > 0 && probe.pool.length === 0;

    if (!suspeito) {
      this.poolVazioSeguidos = 0;
      this.seletorSuspeitoAvisado = false;
      return;
    }

    this.poolVazioSeguidos += 1;
    if (this.poolVazioSeguidos < SELECTOR_SUSPEITO_TICKS || this.seletorSuspeitoAvisado) return;

    this.seletorSuspeitoAvisado = true;
    await logEvent({
      tipoEvento: 'SELETOR_SUSPEITO',
      nivel: 'AVISO',
      origem: 'PAGINA',
      resultado: 'BOLSAO',
      motivo: `O C2S indica ${indicado} lead(s) no Bolsão, mas nenhum card foi lido em ${SELECTOR_SUSPEITO_TICKS} verificações seguidas.`,
      seletorUsado: 'bucketLeadCard',
      contexto: { indicado, lidos: probe.pool.length, ticks: this.poolVazioSeguidos },
    });
    await this.alert(
      {
        title: `${APP_NAME}: layout do Bolsão não reconhecido`,
        message:
          'O C2S mostra leads no Bolsão, mas o bot não conseguiu ler nenhum. Abra o Diagnóstico e gere a auditoria de seletores.',
        priority: 2,
      },
      true,
    );
  }

  private async absorbPool(
    probe: WindowProbeResult,
    janelas: LeadWindow[],
    settings: Settings,
  ): Promise<LeadWindow[]> {
    const now = Date.now();
    const timing = timingOf(settings);

    for (const candidato of probe.pool) {
      if (!shouldCreateWindow(candidato, janelas, { dedupeHours: settings.duplicateProtectionHours, now })) {
        continue;
      }
      const detectadoEm = candidateTime(candidato.criadoEm, now);
      const criada = await this.createOrReopen(candidato, janelas, {
        detectadoEm,
        prazoEm: deadlineWithTimer('POOL', detectadoEm, timing, candidato.segundosRestantes, now),
      });
      if (!criada) continue;

      await this.ensureLead(candidato);
      await logEvent({
        tipoEvento: 'WINDOW_DETECTED',
        nivel: 'INFO',
        origem: 'PAGINA',
        resultado: 'BOLSAO',
        c2sLeadId: candidato.c2sLeadId,
        seletorUsado: candidato.confianca,
      });
      await metricsService.increment('leadsDetectados');
      await metricsService.increment('leadsBolsao');
      await this.alert(
        {
          title: `${APP_NAME}: lead no Bolsão`,
          message: `${candidato.nome ?? 'Lead'} entrou no Bolsão. Janela de ${settings.poolWindowMinutes} min.`,
          priority: 2,
        },
        !settings.inspectMode,
      );
    }

    return janelas;
  }

  private async absorbNormal(
    probe: WindowProbeResult,
    janelas: LeadWindow[],
    settings: Settings,
  ): Promise<LeadWindow[]> {
    const seen = await storageGet<SeenNormal>(SEEN_NORMAL_KEY);

    // Primeira execução: tudo que já está na lista é baseline. Criar janela
    // para lead antigo seria pior do que não fazer nada.
    if (!seen) {
      await this.saveSeen(probe.normal, {});
      return janelas;
    }

    const known = seen.ids;
    const currentIds = probe.normal.map((item) => item.c2sLeadId);
    const overlapIndex = currentIds.findIndex((id) => Boolean(known[id]));
    const novos =
      overlapIndex === -1
        ? []
        : probe.normal.slice(0, overlapIndex).filter((item) => !known[item.c2sLeadId]);

    const timing = timingOf(settings);
    const now = Date.now();
    let resultado = janelas;

    for (const candidato of novos) {
      if (!shouldCreateWindow(candidato, resultado, { dedupeHours: settings.duplicateProtectionHours, now })) {
        continue;
      }
      const detectadoEm = candidateTime(candidato.criadoEm, now);
      const idade = now - new Date(detectadoEm).getTime();
      // Item carregado por scroll/renderização tardia não é lead novo. Exceção:
      // se o próprio C2S publica um contador, ele é a prova de que a janela
      // está aberta — a data exibida pode ser de outra coisa.
      if (candidato.segundosRestantes === undefined && idade > settings.leadWindowMinutes * 60_000) continue;

      const criada = await this.createOrReopen(candidato, resultado, {
        detectadoEm,
        prazoEm: deadlineWithTimer('NORMAL', detectadoEm, timing, candidato.segundosRestantes, now),
      });
      if (!criada) continue;

      await this.ensureLead(candidato);
      await logEvent({
        tipoEvento: 'WINDOW_DETECTED',
        nivel: 'INFO',
        origem: 'PAGINA',
        resultado: 'NORMAL',
        c2sLeadId: candidato.c2sLeadId,
      });
      await metricsService.increment('leadsDetectados');
      await metricsService.increment('leadsDiretos');
      await this.alert(
        {
          title: `${APP_NAME}: lead novo`,
          message: `${candidato.nome ?? 'Lead'} entrou na sua lista. Janela de ${settings.leadWindowMinutes} min.`,
          priority: 1,
        },
        !settings.inspectMode,
      );
    }

    await this.saveSeen(probe.normal, known);
    return resultado;
  }

  private async saveSeen(list: WindowCandidate[], previous: Record<string, string>): Promise<void> {
    const agora = nowIso();
    const merged: Record<string, string> = {};
    for (const item of list) merged[item.c2sLeadId] = previous[item.c2sLeadId] ?? agora;

    // Mantém ids de outros painéis que ainda não expiraram, limitado.
    for (const [id, vistoEm] of Object.entries(previous)) {
      if (merged[id]) continue;
      const idade = Date.now() - new Date(vistoEm).getTime();
      if (Number.isFinite(idade) && idade <= SEEN_TTL_MS) merged[id] = vistoEm;
    }

    const entries = Object.entries(merged)
      .sort((a, b) => (a[1] < b[1] ? 1 : -1))
      .slice(0, MAX_SEEN);
    await storageSet(SEEN_NORMAL_KEY, {
      ids: Object.fromEntries(entries),
      atualizadoEm: agora,
    } satisfies SeenNormal);
  }

  private async createOrReopen(
    candidato: WindowCandidate,
    janelas: LeadWindow[],
    datas: { detectadoEm: string; prazoEm: string },
  ): Promise<LeadWindow | null> {
    const existing = janelas.find((window) => window.c2sLeadId === candidato.c2sLeadId);
    if (!existing) {
      const criada = await windowRepository.create({
        c2sLeadId: candidato.c2sLeadId,
        origem: candidato.origem,
        acao: candidato.origem === 'POOL' ? 'CAPTURAR_BOLSAO' : 'CRIAR_ATIVIDADE',
        detectadoEm: datas.detectadoEm,
        prazoEm: datas.prazoEm,
        confianca: candidato.confianca,
        ...(candidato.nome ? { nome: candidato.nome } : {}),
      });
      janelas.push(criada);
      return criada;
    }

    const reaberta = await windowRepository.patch(existing.id, {
      origem: candidato.origem,
      acao: candidato.origem === 'POOL' ? 'CAPTURAR_BOLSAO' : 'CRIAR_ATIVIDADE',
      estado: 'DETECTADO',
      detectadoEm: datas.detectadoEm,
      prazoEm: datas.prazoEm,
      tentativas: 0,
      proximaTentativaEm: undefined,
      ultimaTentativaEm: undefined,
      bloqueio: undefined,
      bloqueioRetentavel: undefined,
      ultimoErro: undefined,
      interacaoConfirmadaEm: undefined,
      confianca: candidato.confianca,
      ...(candidato.nome ? { nome: candidato.nome } : {}),
    });
    if (!reaberta) return null;
    this.replace(janelas, reaberta);
    return reaberta;
  }

  /* --------------------------- expiração ---------------------------- */

  private async expire(janelas: LeadWindow[], settings: Settings): Promise<LeadWindow[]> {
    for (const window of [...janelas]) {
      if (!isExpired(window)) continue;
      const atualizada = await this.update(janelas, window.id, {
        estado: 'EXPIRADO',
        bloqueio: undefined,
        bloqueioRetentavel: undefined,
        proximaTentativaEm: undefined,
      });
      if (!atualizada) continue;

      await logEvent({
        tipoEvento: 'WINDOW_EXPIRED',
        nivel: 'AVISO',
        origem: 'SISTEMA',
        resultado: window.origem,
        c2sLeadId: window.c2sLeadId,
        motivo: 'Prazo da janela venceu antes da ação.',
      });
      if (window.origem === 'POOL') {
        await metricsService.increment('leadsPerdidos');
        await this.updateLead(window.c2sLeadId, 'PERDIDO', 'PERDIDO');
        await this.alert(
          {
            title: `${APP_NAME}: janela perdida`,
            message: `${window.nome ?? `Lead ${window.c2sLeadId}`} saiu da janela do Bolsão sem captura.`,
          },
          !settings.inspectMode,
        );
      }
    }
    return janelas;
  }

  private async blockActivityWindows(janelas: LeadWindow[]): Promise<LeadWindow[]> {
    for (const window of [...janelas]) {
      if (window.origem !== 'NORMAL') continue;
      if (window.estado === 'BLOQUEADO' && window.bloqueio === ACTIVITY_CONTRACT_REASON) continue;
      if (['EXPIRADO', 'FALHA', 'INTERACAO_CONFIRMADA'].includes(window.estado)) continue;
      await this.update(janelas, window.id, {
        estado: 'BLOQUEADO',
        bloqueio: ACTIVITY_CONTRACT_REASON,
        bloqueioRetentavel: true,
      });
    }
    return janelas;
  }

  /* ------------------------------ ação ------------------------------ */

  private async actNext(
    janelas: LeadWindow[],
    probe: WindowProbeResult,
    settings: Settings,
  ): Promise<void> {
    const poolDisponivel = probe.bucketVisivel && !probe.freeTier && !probe.bolsaoPausado;

    // Até 3 tentativas: uma janela barrada pelo guard não pode travar a fila.
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      // Recalcula a cada volta para enxergar o estado gravado pelo guard.
      const elegiveis = janelas.filter((window) => {
        if (window.origem === 'POOL') return poolDisponivel;
        return FEATURE_FLAGS.activityAutomationEnabled;
      });
      const proxima = selectNext(elegiveis, Date.now());
      if (!proxima) return;

      const acao =
        proxima.acao === 'CAPTURAR_BOLSAO'
          ? ({ type: 'CAPTURAR_BOLSAO', c2sLeadId: proxima.c2sLeadId } as const)
          : ({ type: 'CRIAR_ATIVIDADE', c2sLeadId: proxima.c2sLeadId } as const);

      const decisao = await gateForAction(acao);
      if (!decisao.allowed) {
        await this.update(janelas, proxima.id, {
          estado: 'BLOQUEADO',
          bloqueio: decisao.motivo,
          bloqueioRetentavel: true,
          proximaTentativaEm: new Date(Date.now() + WINDOW_LIMITS.backoffMaxMs).toISOString(),
        });
        if (proxima.bloqueio !== decisao.motivo) {
          await logEvent({
            tipoEvento: 'WINDOW_BLOCKED',
            nivel: 'AVISO',
            origem: 'SISTEMA',
            resultado: proxima.acao,
            c2sLeadId: proxima.c2sLeadId,
            motivo: decisao.motivo,
          });
        }
        continue;
      }

      await this.update(janelas, proxima.id, {
        estado: 'ACAO_PENDENTE',
        tentativas: proxima.tentativas + 1,
        ultimaTentativaEm: nowIso(),
        bloqueio: undefined,
        bloqueioRetentavel: undefined,
        proximaTentativaEm: undefined,
      });

      const tab = this.pickTab();
      if (!tab) return;

      if (settings.bringTabToFront) await this.focusTab(tab.tabId);

      if (proxima.acao === 'CAPTURAR_BOLSAO') {
        await this.runCapture(janelas, proxima, settings, tab.tabId);
      } else {
        await this.runActivity(janelas, proxima, tab.tabId);
      }
      return;
    }
  }

  private async runCapture(
    janelas: LeadWindow[],
    window: LeadWindow,
    settings: Settings,
    tabId: number,
  ): Promise<void> {
    await logEvent({
      tipoEvento: 'CAPTURE_STARTED',
      nivel: 'INFO',
      origem: 'SISTEMA',
      c2sLeadId: window.c2sLeadId,
      contexto: { tentativa: window.tentativas + 1 },
    });

    const response = await requestTab<WindowActionResult>(
      tabId,
      {
        kind: 'window:capture',
        id: 'sw',
        payload: {
          c2sLeadId: window.c2sLeadId,
          atrasoMinMs: settings.poolDelayMinMs,
          atrasoMaxMs: settings.poolDelayMaxMs,
        },
      },
      25_000,
    );

    let resultado = response?.ok ? response.data : null;
    // Navegação completa derruba o content script: a resposta pode nunca
    // chegar. A URL da aba é a prova de que o C2S abriu o lead.
    const urlConfirma = await this.captureSucceededByUrl(
      tabId,
      window.c2sLeadId,
      !resultado || (!resultado.ok && resultado.motivo === 'SEM_CONFIRMACAO'),
    );

    if (urlConfirma) {
      resultado = {
        ok: true,
        motivo: 'SUCESSO_POR_NAVEGACAO',
        etapa: 'confirmacao',
        retentavel: false,
        duracaoMs: 0,
      };
    }

    if (!resultado) {
      await this.failWindow(janelas, window, 'SEM_RESPOSTA_DA_ABA', false, settings);
      return;
    }

    if (resultado.ok) {
      const agora = nowIso();
      await this.update(janelas, window.id, {
        estado: 'ACAO_EXECUTADA',
        bloqueio: undefined,
        bloqueioRetentavel: undefined,
        proximaTentativaEm: undefined,
        interacaoConfirmadaEm: undefined,
      });
      await this.updateLead(window.c2sLeadId, 'CAPTURADO', 'PROTEGIDO', {
        capturadoEm: agora,
        tempoCapturaMs: Date.now() - new Date(window.detectadoEm).getTime(),
      });
      await metricsService.increment(
        'leadsCapturados',
        1,
        Math.max(0, Date.now() - new Date(window.detectadoEm).getTime()),
      );
      await logEvent({
        tipoEvento: 'CAPTURE_SUCCESS',
        nivel: 'INFO',
        origem: 'SISTEMA',
        resultado: resultado.motivo,
        c2sLeadId: window.c2sLeadId,
        duracaoMs: resultado.duracaoMs,
      });
      await logEvent({
        tipoEvento: 'POOL_PAUSED',
        nivel: 'AVISO',
        origem: 'SISTEMA',
        resultado: 'aguardando interação',
        c2sLeadId: window.c2sLeadId,
        motivo: 'Captura realizada. Nova captura do Bolsão só após interação confirmada.',
      });
      await this.alert(
        {
          title: `${APP_NAME}: lead protegido`,
          message: `${window.nome ?? `Lead ${window.c2sLeadId}`} é seu. Fale com o cliente; o Bolsão segue pausado.`,
          priority: 2,
        },
        !settings.inspectMode,
      );
      return;
    }

    if (resultado.motivo === 'LEAD_INDISPONIVEL') {
      await this.update(janelas, window.id, { estado: 'FALHA', ultimoErro: resultado.motivo });
      await this.updateLead(window.c2sLeadId, 'PERDIDO', 'PERDIDO');
      await metricsService.increment('leadsPerdidos');
      await logEvent({
        tipoEvento: 'CAPTURE_LOST_TO_COMPETITOR',
        nivel: 'AVISO',
        origem: 'SISTEMA',
        resultado: resultado.motivo,
        c2sLeadId: window.c2sLeadId,
      });
      await this.alert(
        {
          title: `${APP_NAME}: lead perdido`,
          message: `${window.nome ?? `Lead ${window.c2sLeadId}`} foi capturado antes por outro corretor.`,
        },
        !settings.inspectMode,
      );
      return;
    }

    if (resultado.motivo === 'NAO_INTERAGIDO') {
      await this.update(janelas, window.id, {
        estado: 'BLOQUEADO',
        bloqueio: 'O C2S exige interação com o lead capturado antes de pegar outro.',
        bloqueioRetentavel: false,
        ultimoErro: resultado.motivo,
      });
      await logEvent({
        tipoEvento: 'POOL_PAUSED',
        nivel: 'AVISO',
        origem: 'SISTEMA',
        resultado: resultado.motivo,
        c2sLeadId: window.c2sLeadId,
        motivo: 'O C2S bloqueou nova captura por falta de interação.',
      });
      await this.alert(
        {
          title: `${APP_NAME}: interação pendente`,
          message: 'O C2S exige que você interaja com o lead capturado antes de pegar outro.',
          priority: 2,
        },
        !settings.inspectMode,
      );
      return;
    }

    await this.failWindow(janelas, window, resultado.motivo, resultado.retentavel, settings);
  }

  private async runActivity(
    janelas: LeadWindow[],
    window: LeadWindow,
    tabId: number,
  ): Promise<void> {
    await logEvent({
      tipoEvento: 'ACTIVITY_CREATE_STARTED',
      nivel: 'INFO',
      origem: 'SISTEMA',
      c2sLeadId: window.c2sLeadId,
    });

    const response = await requestTab<WindowActionResult>(
      tabId,
      { kind: 'window:activity', id: 'sw', payload: { c2sLeadId: window.c2sLeadId } },
      15_000,
    );

    if (!response?.ok || !response.data.ok) {
      const motivo = response?.ok ? response.data.motivo : 'SEM_RESPOSTA_DA_ABA';
      await this.update(janelas, window.id, {
        estado: 'BLOQUEADO',
        bloqueio: motivo,
        bloqueioRetentavel: false,
        ultimoErro: motivo,
      });
      await logEvent({
        tipoEvento: 'ACTIVITY_CREATE_FAILED',
        nivel: 'AVISO',
        origem: 'SISTEMA',
        resultado: motivo,
        c2sLeadId: window.c2sLeadId,
      });
      return;
    }

    await this.update(janelas, window.id, {
      estado: 'ACAO_EXECUTADA',
      bloqueio: undefined,
      bloqueioRetentavel: undefined,
      proximaTentativaEm: undefined,
    });
    await metricsService.increment('leadsEmAtendimento');
    await logEvent({
      tipoEvento: 'ACTIVITY_CREATE_SUCCESS',
      nivel: 'INFO',
      origem: 'SISTEMA',
      c2sLeadId: window.c2sLeadId,
    });
  }

  private async failWindow(
    janelas: LeadWindow[],
    window: LeadWindow,
    motivo: string,
    retentavel: boolean,
    settings: Settings,
  ): Promise<void> {
    const tentativas = window.tentativas + 1;
    const podeRetentar = retentavel && tentativas <= Math.max(1, settings.maxRetries);

    if (podeRetentar) {
      await this.update(janelas, window.id, {
        estado: 'ACAO_PENDENTE',
        ultimoErro: motivo,
        proximaTentativaEm: new Date(Date.now() + backoffFor(tentativas)).toISOString(),
      });
    } else {
      await this.update(janelas, window.id, {
        estado: 'FALHA',
        ultimoErro: motivo,
        bloqueio: motivo,
        bloqueioRetentavel: false,
      });
      await metricsService.increment('falhas');
    }

    await logEvent({
      tipoEvento: 'CAPTURE_FAILED',
      nivel: podeRetentar ? 'AVISO' : 'ERRO',
      origem: 'SISTEMA',
      resultado: motivo,
      c2sLeadId: window.c2sLeadId,
      contexto: { tentativas, retentavel: podeRetentar },
    });
  }

  /* ----------------------------- suporte ---------------------------- */

  private pickTab(): { tabId: number; windowId?: number } | null {
    const session = sessionService.get();
    if (session.tabId !== undefined) {
      return {
        tabId: session.tabId,
        ...(session.windowId !== undefined ? { windowId: session.windowId } : {}),
      };
    }
    const primary = tabRegistry.primary();
    return primary
      ? {
          tabId: primary.tabId,
          ...(primary.windowId !== undefined ? { windowId: primary.windowId } : {}),
        }
      : null;
  }

  /**
   * Pede ao Chrome para não descartar a aba do C2S por falta de memória.
   * Não substitui o usuário manter a aba ativa: descarte e congelamento por
   * muito tempo em segundo plano ainda podem acontecer.
   */
  private async protectTab(tabId: number): Promise<void> {
    if (this.protectedTabs.has(tabId)) return;
    try {
      await chrome.tabs.update(tabId, { autoDiscardable: false });
      this.protectedTabs.add(tabId);
    } catch {
      /* versão antiga do Chrome ou aba já fechada: segue sem proteção */
    }
  }

  private async focusTab(tabId: number): Promise<void> {
    try {
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== undefined && chrome.windows) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch {
      return;
    }
    // Dá tempo do Chrome tirar a aba do estado oculto antes do clique.
    await sleep(1_200);
  }

  private async captureSucceededByUrl(
    tabId: number,
    c2sLeadId: string,
    shouldCheck: boolean,
  ): Promise<boolean> {
    if (!shouldCheck) return false;
    for (let tentativa = 0; tentativa < 4; tentativa += 1) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url) {
          const path = new URL(tab.url).pathname;
          if (path === `/webapp/leads/${c2sLeadId}` || path.startsWith(`/webapp/leads/${c2sLeadId}/`)) {
            return true;
          }
        }
      } catch {
        return false;
      }
      await sleep(500);
    }
    return false;
  }

  private async update(
    janelas: LeadWindow[],
    id: string,
    patch: Partial<LeadWindow>,
  ): Promise<LeadWindow | undefined> {
    const atualizada = await windowRepository.patch(id, patch);
    if (atualizada) this.replace(janelas, atualizada);
    return atualizada;
  }

  private replace(janelas: LeadWindow[], atualizada: LeadWindow): void {
    const index = janelas.findIndex((window) => window.id === atualizada.id);
    if (index >= 0) janelas[index] = atualizada;
  }

  private async ensureLead(candidato: WindowCandidate): Promise<void> {
    const existing = await leadRepository.findByC2sId(candidato.c2sLeadId);
    if (existing) return;
    await leadRepository.upsert({
      c2sLeadId: candidato.c2sLeadId,
      ...(candidato.nome ? { nome: candidato.nome } : {}),
      origemTipo: candidato.origem === 'POOL' ? 'BOLSAO' : 'DIRETO',
      statusLocal: 'NOVO',
      resultado: 'PENDENTE',
    });
  }

  private async updateLead(
    c2sLeadId: string,
    statusLocal: 'CAPTURADO' | 'PERDIDO' | 'EM_ATENDIMENTO',
    resultado: 'PROTEGIDO' | 'PERDIDO',
    extra: { capturadoEm?: string; tempoCapturaMs?: number } = {},
  ): Promise<void> {
    const existing = await leadRepository.findByC2sId(c2sLeadId);
    if (!existing) return;
    await leadRepository.update(existing.id, {
      statusLocal,
      resultado,
      ...(extra.capturadoEm ? { capturadoEm: extra.capturadoEm } : {}),
      ...(extra.tempoCapturaMs !== undefined ? { tempoCapturaMs: extra.tempoCapturaMs } : {}),
    });
  }

  private async alert(
    input: { title: string; message: string; priority?: number },
    permitido: boolean,
  ): Promise<void> {
    if (!permitido) return;
    const settings = await settingsRepository.get();
    if (!settings.desktopNotifications) return;
    await notificationService.notify({
      title: input.title,
      message: input.message,
      priority: input.priority ?? 1,
      sound: settings.soundAlerts,
    });
  }

  private async persistMeta(meta: WindowTickMeta, settings: Settings): Promise<void> {
    await storageSet(TICK_KEY, meta);
    await broadcastToPanel({
      type: 'status',
      payload: {
        status: meta.poolPausado.pausado ? 'BOLSAO_PAUSADO' : 'MONITORANDO',
        botActive: settings.botActive,
        inspectMode: settings.inspectMode,
        conectado: meta.abaRespondeu,
        atualizadoEm: meta.ultimoTickEm,
      },
    });
  }

  /** O painel relê o estado depois de uma mudança feita fora do tick. */
  private async refreshPanel(): Promise<void> {
    const settings = await settingsRepository.get();
    await broadcastToPanel({
      type: 'status',
      payload: {
        status: 'JANELAS_ATUALIZADAS',
        botActive: settings.botActive,
        inspectMode: settings.inspectMode,
        conectado: true,
        atualizadoEm: nowIso(),
      },
    });
  }
}

export const windowEngine = new WindowEngine();
