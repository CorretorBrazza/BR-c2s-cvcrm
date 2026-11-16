import { CVRM_ALVO, CVRM_ENTRADA, CVRM_LIMITS, CVRM_PATHS, CVRM_STAGES } from '../constants/cvcrm';
import type {
  CvContext,
  CvDecision,
  CvKanbanLead,
  CvMove,
  CvMoveState,
  CvPanelReading,
  CvState,
} from '../types/cvcrm';

/**
 * Núcleo puro do módulo CV CRM: nada de `chrome.*`, DOM ou storage.
 *
 * Toda decisão do robô passa por aqui, o que permite provar as regras com
 * testes sem abrir um navegador.
 */

const LEAD_ID = /^\d{1,20}$/;

export function isValidLeadId(value: unknown): value is string {
  return typeof value === 'string' && LEAD_ID.test(value);
}

export function isCvHost(hostname: string): boolean {
  return hostname === 'cvcrm.com.br' || hostname.endsWith('.cvcrm.com.br');
}

export interface CvUrlInfo {
  context: CvContext;
  host: string;
  leadId?: string;
}

/**
 * Classifica a URL do CV CRM. O tenant é o host, então nunca fixamos
 * `abiatar`: o mesmo código serve outro cliente.
 */
export function cvUrlInfo(url: string): CvUrlInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { context: 'OUTRO', host: '' };
  }

  const host = parsed.hostname;
  if (!isCvHost(host)) return { context: 'OUTRO', host };

  if (/\/(login|sair)\b/i.test(parsed.pathname)) return { context: 'LOGIN', host };

  const admin = /^\/corretor\/comercial\/leads\/(\d{1,20})\/administrar\/?$/.exec(parsed.pathname);
  if (admin?.[1]) return { context: 'LEAD_ADMIN', host, leadId: admin[1] };

  if (parsed.pathname.replace(/\/+$/, '').endsWith(CVRM_PATHS.kanban)) {
    return { context: 'KANBAN', host };
  }

  return { context: 'OUTRO', host };
}

export function adminUrl(host: string, leadId: string): string {
  const path = CVRM_PATHS.leadAdministrar.replace('{id}', leadId);
  return `https://${host}${path}`;
}

export function stageDef(id: number) {
  return CVRM_STAGES.find((stage) => stage.id === id);
}

export function stageLabel(id: number): string {
  return stageDef(id)?.label.trim() ?? `Etapa ${id}`;
}

/**
 * Decide o que fazer com o painel lido. A ordem das checagens é a ordem da
 * segurança: primeiro "não dá para confiar no DOM", depois "não é o lead",
 * depois "não é a coluna", e só então age.
 */
export function decidirMovimento(reading: CvPanelReading): CvDecision {
  if (!isValidLeadId(reading.leadId)) return { kind: 'BLOQUEADO', motivo: 'LEAD_ID_INVALIDO' };
  if (reading.workflows === 0 || !reading.temForm) return { kind: 'BLOQUEADO', motivo: 'SEM_FORM' };
  if (reading.workflows > 1) return { kind: 'BLOQUEADO', motivo: 'WORKFLOW_AMBIGUO' };
  if (reading.atual === null) return { kind: 'BLOQUEADO', motivo: 'ETAPA_ATUAL_DESCONHECIDA' };
  if (reading.atual === CVRM_ALVO) return { kind: 'NOOP', motivo: 'JA_ESTA_NO_ALVO' };
  if (reading.atual !== CVRM_ENTRADA) {
    return { kind: 'BLOQUEADO', motivo: 'NAO_E_DA_COLUNA_DE_ENTRADA' };
  }

  const alvo = reading.etapas.find((etapa) => etapa.id === CVRM_ALVO);
  if (!alvo || !alvo.acionavel) return { kind: 'BLOQUEADO', motivo: 'ALVO_INDISPONIVEL' };

  return {
    kind: 'MOVER',
    leadId: reading.leadId,
    de: reading.atual,
    para: CVRM_ALVO,
    labelAlvo: alvo.label,
  };
}

/* ------------------------------------------------------------------ */
/* Estado: linha de base, primeira vez e histórico                    */
/* ------------------------------------------------------------------ */

const UM_DIA = 24 * 60 * 60_000;
const RETENCAO_LEMBRANCA_MS = 7 * UM_DIA;
const MAX_BASELINE = 1_000;
const MAX_LEMBRANCA = 5_000;

export function emptyCvState(): CvState {
  return {
    baselineEm: '',
    baselineIds: [],
    primeiraVez: {},
    ultimaEtapa: {},
    movimentos: [],
    pendente: null,
    ultimoTickEm: '',
    ultimoToastEm: '',
  };
}

/**
 * Primeira ativação: tudo o que já está na coluna de entrada vira linha de
 * base e nunca é movido. Isso é o "só leads novos" — sem exceção.
 */
export function iniciarBaseline(state: CvState, leads: CvKanbanLead[], agoraIso: string): CvState {
  const naEntrada = leads.filter((lead) => lead.etapa === CVRM_ENTRADA);
  const primeiraVez = { ...state.primeiraVez };
  for (const lead of naEntrada) primeiraVez[lead.leadId] = agoraIso;

  return {
    ...state,
    baselineEm: agoraIso,
    baselineIds: naEntrada.map((lead) => lead.leadId).slice(-MAX_BASELINE),
    primeiraVez,
    ultimaEtapa: mesclarEtapas(state.ultimaEtapa, leads),
  };
}

function mesclarEtapas(
  atual: Record<string, number>,
  leads: CvKanbanLead[],
): Record<string, number> {
  const proximo = { ...atual };
  for (const lead of leads) proximo[lead.leadId] = lead.etapa;
  return proximo;
}

/**
 * Aplica uma leitura do kanban ao estado. `primeiraVez` só é gravado na
 * primeira observação — é a base do atraso de 5s e do corte de idade.
 */
export function mergeKanban(
  state: CvState,
  leads: CvKanbanLead[],
  agoraIso: string,
): CvState {
  const primeiraVez = { ...state.primeiraVez };
  for (const lead of leads) {
    if (!isValidLeadId(lead.leadId)) continue;
    if (!primeiraVez[lead.leadId]) primeiraVez[lead.leadId] = agoraIso;
  }

  const podado = podar(state, primeiraVez, agoraIso);
  return {
    ...state,
    primeiraVez: podado.primeiraVez,
    ultimaEtapa: mesclarEtapas(podado.ultimaEtapa, leads),
    ultimoTickEm: agoraIso,
  };
}

/** Remove lembranças antigas para o estado não crescer sem limite. */
function podar(state: CvState, primeiraVez: Record<string, string>, agoraIso: string): CvState {
  const agora = new Date(agoraIso).getTime();
  const limite = Number.isNaN(agora) ? 0 : agora - RETENCAO_LEMBRANCA_MS;
  const manter: Record<string, string> = {};
  const mantidos: Array<[string, string]> = [];

  for (const [id, iso] of Object.entries(primeiraVez)) {
    const quando = new Date(iso).getTime();
    if (Number.isNaN(quando) || quando >= limite) mantidos.push([id, iso]);
  }
  if (mantidos.length > MAX_LEMBRANCA) {
    mantidos.sort((a, b) => (a[1] < b[1] ? 1 : -1));
    mantidos.length = MAX_LEMBRANCA;
  }
  for (const [id, iso] of mantidos) manter[id] = iso;

  const ultimaEtapa: Record<string, number> = {};
  for (const id of Object.keys(manter)) {
    const etapa = state.ultimaEtapa[id];
    if (typeof etapa === 'number') ultimaEtapa[id] = etapa;
  }

  return { ...state, primeiraVez: manter, ultimaEtapa };
}

export interface CvTiming {
  atrasoMs: number;
  idadeMaxMs: number;
}

export function timingFrom(segundos: number, horas: number): CvTiming {
  const clamp = (valor: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, valor)));
  return {
    atrasoMs: clamp(segundos, CVRM_LIMITS.delaySeconds.min, CVRM_LIMITS.delaySeconds.max) * 1_000,
    idadeMaxMs:
      clamp(horas, CVRM_LIMITS.maxAgeHours.min, CVRM_LIMITS.maxAgeHours.max) * 60 * 60_000,
  };
}

function jaTentado(state: CvState, leadId: string): boolean {
  return state.movimentos.some((movimento) => movimento.leadId === leadId);
}

/**
 * Próximo lead a mover. Falha fechada em todos os sentidos:
 *  - lead já visto na ativação (linha de base) nunca entra;
 *  - lead com qualquer movimento registrado nunca é retentado;
 *  - lead recém-visto espera o atraso configurado;
 *  - lead que esperou demais (automação bloqueada) é descartado.
 */
export function selectElegivel(
  state: CvState,
  leads: CvKanbanLead[],
  agora: number,
  timing: CvTiming,
): CvKanbanLead | undefined {
  if (state.pendente) return undefined;

  const baseline = new Set(state.baselineIds);
  const candidatos = leads
    .filter((lead) => lead.etapa === CVRM_ENTRADA)
    .filter((lead) => isValidLeadId(lead.leadId))
    .filter((lead) => !baseline.has(lead.leadId))
    .filter((lead) => !jaTentado(state, lead.leadId))
    .filter((lead) => {
      const visto = state.primeiraVez[lead.leadId];
      if (!visto) return false;
      const quando = new Date(visto).getTime();
      if (Number.isNaN(quando)) return false;
      const idade = agora - quando;
      return idade >= timing.atrasoMs && idade <= timing.idadeMaxMs;
    })
    .sort((a, b) => {
      const quandoA = new Date(state.primeiraVez[a.leadId] ?? 0).getTime();
      const quandoB = new Date(state.primeiraVez[b.leadId] ?? 0).getTime();
      return quandoA - quandoB;
    });

  return candidatos[0];
}

/* ------------------------------------------------------------------ */
/* Histórico                                                          */
/* ------------------------------------------------------------------ */

const ESTADOS_TERMINAIS: readonly CvMoveState[] = ['CONFIRMADO', 'FALHA', 'BLOQUEADO'];

/** Um movimento já encerrado não volta a ser executado nem notificado. */
export function movimentoEncerrado(movimento?: CvMove): boolean {
  return movimento !== undefined && ESTADOS_TERMINAIS.includes(movimento.estado);
}

/**
 * Registra/atualiza um movimento.
 *
 * Estado terminal nunca é rebaixado: a página pode confirmar a etapa 4 antes de
 * o service worker gravar o `CLICADO` (o clique é agendado após a resposta).
 * Sem esta regra, o `CLICADO` atrasado reabriria um movimento já confirmado e o
 * lead acabaria marcado como falha no timeout.
 */
export function comMovimento(state: CvState, movimento: CvMove): CvState {
  const existente = state.movimentos.find((item) => item.id === movimento.id);
  if (
    existente &&
    ESTADOS_TERMINAIS.includes(existente.estado) &&
    !ESTADOS_TERMINAIS.includes(movimento.estado)
  ) {
    return state;
  }

  const outros = state.movimentos.filter((item) => item.id !== movimento.id);
  const movimentos = [movimento, ...outros].slice(0, CVRM_LIMITS.maxHistorico);
  const terminou = ESTADOS_TERMINAIS.includes(movimento.estado);

  return { ...state, movimentos, pendente: terminou ? null : movimento };
}

export function limparPendente(state: CvState): CvState {
  return { ...state, pendente: null };
}

/** Leads conhecidos que continuam parados na entrada (para o painel). */
export function elegiveisParaPainel(
  state: CvState,
  leads: CvKanbanLead[],
  agora: number,
  timing: CvTiming,
): CvKanbanLead[] {
  const baseline = new Set(state.baselineIds);
  return leads
    .filter((lead) => lead.etapa === CVRM_ENTRADA)
    .filter((lead) => !baseline.has(lead.leadId))
    .filter((lead) => !jaTentado(state, lead.leadId))
    .filter((lead) => {
      const visto = state.primeiraVez[lead.leadId];
      if (!visto) return false;
      const quando = new Date(visto).getTime();
      return Number.isFinite(quando) && agora - quando <= timing.idadeMaxMs;
    })
    .sort((a, b) => {
      const quandoA = new Date(state.primeiraVez[a.leadId] ?? 0).getTime();
      const quandoB = new Date(state.primeiraVez[b.leadId] ?? 0).getTime();
      return quandoA - quandoB;
    });
}
