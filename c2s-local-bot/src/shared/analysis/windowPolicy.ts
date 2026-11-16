import type {
  LeadOrigin,
  LeadWindow,
  LeadWindowAction,
  LeadWindowState,
  PoolPauseState,
  WindowCandidate,
  WindowStats,
  WindowTiming,
} from '../types/window';

/**
 * Regras puras da janela de interação. Nada aqui toca em `chrome.*`, DOM ou
 * storage: é o núcleo testável que o engine e o painel compartilham.
 */

export const WINDOW_LIMITS = {
  poolDefaultMinutes: 3,
  poolMinMinutes: 1,
  poolMaxMinutes: 30,
  leadDefaultMinutes: 30,
  leadMinMinutes: 5,
  leadMaxMinutes: 1_440,
  /** Aviso visual quando falta menos que isso. */
  atencaoSegundos: 60,
  /** Teto do backoff de uma janela bloqueada/falha retentável. */
  backoffBaseMs: 30_000,
  backoffMaxMs: 5 * 60_000,
  /** Sem tick por mais que isso = máquina suspensa/hibernada. */
  suspensaoMs: 2 * 60_000,
} as const;

export const TERMINAL_STATES: readonly LeadWindowState[] = [
  'INTERACAO_CONFIRMADA',
  'EXPIRADO',
  'FALHA',
] as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function actionFor(origem: LeadOrigin): LeadWindowAction {
  return origem === 'POOL' ? 'CAPTURAR_BOLSAO' : 'CRIAR_ATIVIDADE';
}

export function windowMinutesFor(origem: LeadOrigin, timing: WindowTiming): number {
  return origem === 'POOL'
    ? clamp(timing.poolMinutes, WINDOW_LIMITS.poolMinMinutes, WINDOW_LIMITS.poolMaxMinutes)
    : clamp(timing.leadMinutes, WINDOW_LIMITS.leadMinMinutes, WINDOW_LIMITS.leadMaxMinutes);
}

export function deadlineFor(origem: LeadOrigin, detectadoEm: string, timing: WindowTiming): string {
  const parsed = new Date(detectadoEm).getTime();
  const base = Number.isNaN(parsed) ? Date.now() : parsed;
  return new Date(base + windowMinutesFor(origem, timing) * 60_000).toISOString();
}

/**
 * Prazo com o contador do próprio C2S.
 *
 * Quando o lead exibe `.bucket-time .timer-count[data-seconds]`, esse número é a
 * fonte de verdade (é o prazo que o C2S aplica). Ele nunca ESTENDE o prazo
 * configurado pelo corretor: vale o menor dos dois.
 */
export function deadlineWithTimer(
  origem: LeadOrigin,
  detectadoEm: string,
  timing: WindowTiming,
  segundosRestantes?: number,
  now = Date.now(),
): string {
  const porConfiguracao = deadlineFor(origem, detectadoEm, timing);
  if (
    segundosRestantes === undefined ||
    !Number.isFinite(segundosRestantes) ||
    segundosRestantes <= 0
  ) {
    return porConfiguracao;
  }
  const porTimer = new Date(now + Math.round(segundosRestantes) * 1_000).toISOString();
  return porTimer < porConfiguracao ? porTimer : porConfiguracao;
}

export function isTerminal(window: LeadWindow): boolean {
  return TERMINAL_STATES.includes(window.estado);
}

export function isExpired(window: LeadWindow, now = Date.now()): boolean {
  if (isTerminal(window) || window.estado === 'ACAO_EXECUTADA') return false;
  const prazo = new Date(window.prazoEm).getTime();
  if (Number.isNaN(prazo)) return false;
  return prazo <= now;
}

export function remainingMs(window: LeadWindow, now = Date.now()): number {
  const prazo = new Date(window.prazoEm).getTime();
  if (Number.isNaN(prazo)) return 0;
  return Math.max(0, prazo - now);
}

export type WindowHealth = 'NO_PRAZO' | 'ATENCAO' | 'VENCENDO' | 'VENCIDA';

export function windowHealth(window: LeadWindow, now = Date.now()): WindowHealth {
  if (window.estado === 'EXPIRADO' || remainingMs(window, now) <= 0) return 'VENCIDA';
  const restante = remainingMs(window, now);
  if (restante <= WINDOW_LIMITS.atencaoSegundos * 1_000) return 'VENCENDO';

  const detectado = new Date(window.detectadoEm).getTime();
  const prazo = new Date(window.prazoEm).getTime();
  const total = Number.isFinite(detectado) && prazo > detectado ? prazo - detectado : 0;
  if (total > 0 && restante <= total * 0.25) return 'ATENCAO';
  return 'NO_PRAZO';
}

/**
 * Elegível para agir agora: não terminal, não expirada, fora do backoff.
 * `BLOQUEADO` é elegível de novo — o motivo do bloqueio (inspeção, licença,
 * sessão) pode desaparecer.
 */
export function isActionable(window: LeadWindow, now = Date.now()): boolean {
  if (isTerminal(window) || window.estado === 'ACAO_EXECUTADA') return false;
  if (window.estado === 'BLOQUEADO' && window.bloqueioRetentavel === false) return false;
  if (isExpired(window, now)) return false;
  if (window.proximaTentativaEm && new Date(window.proximaTentativaEm).getTime() > now) return false;
  return true;
}

/**
 * Regra do Bolsão: 1 captura → protege → alerta → **pausa o pool** até existir
 * evidência de interação. Nunca existe promessa de captura em série.
 */
export function poolPaused(windows: LeadWindow[]): PoolPauseState {
  const protegido = windows.find(
    (window) =>
      window.origem === 'POOL' && window.estado === 'ACAO_EXECUTADA' && !window.interacaoConfirmadaEm,
  );
  if (!protegido) return { pausado: false };
  return {
    pausado: true,
    motivo: 'Captura realizada: aguardando interação confirmada com o lead.',
    janelaId: protegido.id,
    c2sLeadId: protegido.c2sLeadId,
  };
}

/**
 * Próxima janela a agir. Bolsão primeiro (a janela é uma corrida), depois a de
 * prazo mais curto. Se o pool está pausado, só leads normais avançam.
 */
export function selectNext(windows: LeadWindow[], now = Date.now()): LeadWindow | undefined {
  const pause = poolPaused(windows);
  return windows
    .filter((window) => isActionable(window, now))
    .filter((window) => !(pause.pausado && window.origem === 'POOL'))
    .sort((a, b) => {
      if (a.origem !== b.origem) return a.origem === 'POOL' ? -1 : 1;
      return new Date(a.prazoEm).getTime() - new Date(b.prazoEm).getTime();
    })[0];
}

/**
 * Cria janela só para lead novo. Lead já conhecido não abre janela nova dentro
 * da janela de proteção contra duplicidade.
 */
export function shouldCreateWindow(
  candidate: WindowCandidate,
  windows: LeadWindow[],
  input: { now?: number; dedupeHours: number },
): boolean {
  const now = input.now ?? Date.now();
  const existente = windows.find((window) => window.c2sLeadId === candidate.c2sLeadId);
  if (!existente) return true;
  if (!isTerminal(existente) && !isExpired(existente, now)) return false;

  const dedupeMs = Math.max(1, input.dedupeHours) * 3_600_000;
  const atualizado = new Date(existente.atualizadoEm).getTime();
  if (Number.isNaN(atualizado)) return true;
  return now - atualizado >= dedupeMs;
}

export function backoffFor(tentativas: number): number {
  const safe = Math.max(0, Math.min(tentativas, 10));
  return Math.min(WINDOW_LIMITS.backoffMaxMs, WINDOW_LIMITS.backoffBaseMs * 2 ** safe);
}

export function emptyStats(): WindowStats {
  return {
    DETECTADO: 0,
    ACAO_PENDENTE: 0,
    ACAO_EXECUTADA: 0,
    INTERACAO_CONFIRMADA: 0,
    BLOQUEADO: 0,
    EXPIRADO: 0,
    FALHA: 0,
  };
}

export function statsOf(windows: LeadWindow[]): WindowStats {
  const stats = emptyStats();
  for (const window of windows) stats[window.estado] += 1;
  return stats;
}

/** Janelas que precisam de atenção humana agora. */
export function needsAttention(windows: LeadWindow[], now = Date.now()): LeadWindow[] {
  return windows
    .filter((window) => !isTerminal(window))
    .filter((window) => window.estado !== 'INTERACAO_CONFIRMADA')
    .filter(
      (window) =>
        window.estado === 'BLOQUEADO' ||
        window.estado === 'ACAO_EXECUTADA' ||
        windowHealth(window, now) === 'VENCENDO' ||
        windowHealth(window, now) === 'VENCIDA',
    );
}
