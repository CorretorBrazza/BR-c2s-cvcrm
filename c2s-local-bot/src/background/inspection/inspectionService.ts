import { LIMITS } from '../../shared/constants/limits';
import { ENDPOINT_PATTERNS } from '../../shared/constants/endpoints';
import { FEATURE_FLAGS } from '../../shared/constants/featureFlags';
import type {
  CalibrationBundle,
  CalibrationContract,
  CalibrationCounts,
  CalibrationReadiness,
  CaptureScriptEvidence,
  DomSample,
  EndpointType,
  InspectionStatus,
  NetworkSample,
  PageContext,
  SelectorProfile,
} from '../../shared/types/inspection';
import { analyzeCalibrationContract } from '../../shared/analysis/contractAnalyzer';
import type { Settings } from '../../shared/types/settings';
import { nowIso } from '../../shared/utils/dateUtils';
import { newId } from '../../shared/utils/idGenerator';
import { parseJsonSafe, stableHash, truncate } from '../../shared/utils/validation';
import { APP_VERSION } from '../../shared/constants/defaults';
import { maskText } from '../security/dataMasking';
import { broadcastToPanel } from '../events/eventBus';
import { logEvent } from '../events/logEvent';
import { inspectionRepository } from '../storage/repositories/inspectionRepository';
import { settingsRepository } from '../storage/repositories/settingsRepository';

export function classifyEndpoint(url: string, method: string): EndpointType {
  if (ENDPOINT_PATTERNS.bucketLeadApi.test(url)) return 'BUCKET_LEADS';
  if (ENDPOINT_PATTERNS.bucketLeads.test(url)) return 'BUCKET_LEADS';
  if (ENDPOINT_PATTERNS.leadsV2.test(url)) return 'LEADS_V2';
  if (ENDPOINT_PATTERNS.statusUpdate.test(url)) return 'STATUS_UPDATE';
  if (ENDPOINT_PATTERNS.funnelMove.test(url)) return 'FUNNEL_MOVE';
  if (ENDPOINT_PATTERNS.activityCreate.test(url)) return 'ACTIVITY_CREATE';
  if (ENDPOINT_PATTERNS.replySend.test(url)) return 'REPLY_SEND';
  if (ENDPOINT_PATTERNS.whatsappClick.test(url)) return 'WHATSAPP_CLICK';
  if (ENDPOINT_PATTERNS.leadDetail.test(url)) return 'LEAD_DETAIL';
  if (/\/webapp\/leads/i.test(url)) return 'LEAD_HASH';
  if (method === 'GET' || method === 'POST') return 'DESCONHECIDO';
  return 'DESCONHECIDO';
}

const PAGE_CONTEXTS: PageContext[] = [
  'CONTACTS_LIST',
  'BUCKET',
  'LEAD_DETAIL',
  'LOGIN',
  'UNKNOWN',
];

function safeContext(value: unknown): PageContext {
  return PAGE_CONTEXTS.includes(value as PageContext) ? (value as PageContext) : 'UNKNOWN';
}

function safeString(value: unknown, max: number): string {
  return typeof value === 'string' ? truncate(value, max).value : '';
}

function safeHeaders(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 60);
  const output: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (typeof item !== 'string') continue;
    const normalized = key.toLowerCase();
    if (['cookie', 'authorization', 'set-cookie', 'x-csrf-token'].includes(normalized)) {
      output[normalized] = '[REDACTED]';
      continue;
    }
    output[normalized] = item.slice(0, 1_024);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

/**
 * Valida a evidência de script vinda do content script (entrada não confiável).
 * Só booleanos e caminhos fixos passam; qualquer texto livre é descartado.
 */
export function safeCaptureScript(input: unknown): CaptureScriptEvidence | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const raw = input as Record<string, unknown>;
  const caminho = raw.caminho === '/bucket_leads/{id}' ? '/bucket_leads/{id}' : '';
  const navegacaoSucesso = raw.navegacaoSucesso === '/webapp/leads/{id}' ? '/webapp/leads/{id}' : '';
  const sinalUpselling = raw.sinalUpselling === 'redirect_to_upselling' ? 'redirect_to_upselling' : '';
  if (!caminho) return undefined;
  return {
    metodoPost: raw.metodoPost === true,
    metodoGetPreChecagem: raw.metodoGetPreChecagem === true,
    caminho,
    navegacaoSucesso,
    sinalUpselling,
    csrfMetaPresente: raw.csrfMetaPresente === true,
  };
}

/**
 * Serviço de inspeção: única porta de entrada para amostras vindas do content
 * script. Nada é gravado fora do modo inspeção.
 */
class InspectionService {
  private inspectMode = true;
  private includePii = false;
  private captureScreenshots = true;
  private lastSampleAt: string | undefined;
  private dedupe = new Map<string, number>();

  async hydrate(): Promise<void> {
    const settings = await settingsRepository.get();
    this.applySettings(settings);
  }

  applySettings(settings: Settings): void {
    this.inspectMode = settings.inspectMode;
    this.includePii = settings.inspectIncludePii;
    this.captureScreenshots = settings.inspectCaptureScreenshots;
  }

  isActive(): boolean {
    return this.inspectMode && FEATURE_FLAGS.inspectionEnabled;
  }

  shouldCaptureScreenshots(): boolean {
    return this.isActive() && this.captureScreenshots;
  }

  /** Sanitiza + classifica uma amostra de rede. */
  normalizeNetwork(input: unknown, source: 'LIVE' | 'IMPORT'): NetworkSample | null {
    if (typeof input !== 'object' || input === null) return null;
    const raw = input as Record<string, unknown>;

    const url = safeString(raw.url, 4_096);
    if (!url || !/^https?:\/\//i.test(url)) return null;

    const method = safeString(raw.method, 16).toUpperCase() || 'GET';
    const truncatedBody = typeof raw.responseBody === 'string' ? raw.responseBody : null;
    const requestBody = typeof raw.requestBody === 'string' ? raw.requestBody : null;

    const sample: NetworkSample = {
      id: newId('net'),
      correlationId: safeString(raw.correlationId, 64) || newId('corr'),
      timestamp: safeString(raw.timestamp, 40) || nowIso(),
      url,
      method,
      status: typeof raw.status === 'number' && Number.isFinite(raw.status) ? raw.status : undefined,
      endpointType: classifyEndpoint(url, method),
      durationMs:
        typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
          ? Math.max(0, raw.durationMs)
          : undefined,
      requestHeaders: safeHeaders(raw.requestHeaders),
      requestBody: requestBody ? truncate(requestBody, LIMITS.maxNetworkBodyBytes).value : null,
      responseBody: truncatedBody ? truncate(truncatedBody, LIMITS.maxNetworkBodyBytes).value : null,
      responseContentType: typeof raw.responseContentType === 'string' ? raw.responseContentType.slice(0, 200) : null,
      responseSize: typeof raw.responseSize === 'number' ? raw.responseSize : undefined,
      truncated: raw.truncated === true,
      untrusted: true,
      pageContext: safeContext(raw.pageContext),
      tabId: typeof raw.tabId === 'number' ? raw.tabId : undefined,
      erro: typeof raw.erro === 'string' ? raw.erro.slice(0, 300) : undefined,
    };

    if (source === 'IMPORT') sample.untrusted = true;
    if (!this.includePii) {
      sample.requestBody = sample.requestBody ? maskText(sample.requestBody) : sample.requestBody;
      sample.responseBody = sample.responseBody ? maskText(sample.responseBody) : sample.responseBody;
      sample.correlationId = sample.correlationId;
    }
    return sample;
  }

  async ingestNetwork(samples: unknown[], tabId?: number): Promise<number> {
    if (!this.isActive()) return 0;
    const normalized: NetworkSample[] = [];
    const agora = Date.now();

    for (const item of samples.slice(0, 50)) {
      const sample = this.normalizeNetwork(item, 'LIVE');
      if (!sample) continue;
      if (tabId !== undefined) sample.tabId = tabId;

      const fingerprint = stableHash(
        `${sample.method}|${sample.url}|${sample.requestBody ?? ''}|${sample.responseBody?.slice(0, 2_000) ?? ''}`,
      );
      const seenAt = this.dedupe.get(fingerprint);
      if (seenAt && agora - seenAt < LIMITS.networkDedupeWindowMs) continue;
      this.dedupe.set(fingerprint, agora);
      // Mantém o mapa pequeno mesmo em sessões longas.
      if (this.dedupe.size > 2_000) this.dedupe.clear();

      normalized.push(sample);
    }

    if (normalized.length === 0) return 0;
    await inspectionRepository.addNetwork(normalized);
    this.lastSampleAt = normalized[normalized.length - 1]?.timestamp ?? nowIso();

    await logEvent({
      tipoEvento: 'INSPECT_NETWORK_SAMPLE',
      nivel: 'INFO',
      origem: 'INSPECAO',
      resultado: `${normalized.length} amostra(s)`,
      contexto: { endpoints: normalized.map((sample) => sample.endpointType) },
    });
    await this.broadcastStatus();
    return normalized.length;
  }

  async ingestDom(input: unknown): Promise<boolean> {
    if (!this.isActive()) return false;
    if (typeof input !== 'object' || input === null) return false;
    const raw = input as Record<string, unknown>;

    const html = typeof raw.html === 'string' ? raw.html : '';
    if (!html) return false;
    const truncated = truncate(html, LIMITS.maxDomBytes);
    const masked = this.includePii ? truncated.value : maskText(truncated.value);
    const captureScript = safeCaptureScript(raw.captureScript);

    const sample: DomSample = {
      id: newId('dom'),
      timestamp: nowIso(),
      context: safeContext(raw.context),
      url: safeString(raw.url, 2_048),
      html: masked,
      truncated: truncated.truncated || raw.truncated === true,
      piiIncluded: this.includePii,
      tamanhoOriginal: html.length,
      ...(captureScript ? { captureScript } : {}),
    };

    await inspectionRepository.addDom(sample);
    this.lastSampleAt = sample.timestamp;
    await logEvent({
      tipoEvento: 'INSPECT_DOM_SAMPLE',
      nivel: 'INFO',
      origem: 'INSPECAO',
      resultado: sample.context,
      seletorUsado: sample.url,
    });
    await this.broadcastStatus();
    return true;
  }

  async ingestSelectors(input: unknown): Promise<boolean> {
    if (!this.isActive()) return false;
    if (typeof input !== 'object' || input === null) return false;
    const raw = input as Record<string, unknown>;
    if (!Array.isArray(raw.candidates)) return false;

    const profile: SelectorProfile = {
      id: newId('sel'),
      timestamp: nowIso(),
      context: safeContext(raw.context),
      url: safeString(raw.url, 2_048),
      candidates: raw.candidates.slice(0, 80).map((candidate) => {
        const item = (candidate ?? {}) as Record<string, unknown>;
        return {
          concept: safeString(item.concept, 80),
          selector: safeString(item.selector, 400),
          score: typeof item.score === 'number' ? item.score : 0,
          matches: typeof item.matches === 'number' ? item.matches : 0,
          visiveis: typeof item.visiveis === 'number' ? item.visiveis : 0,
          nota: typeof item.nota === 'string' ? item.nota.slice(0, 200) : undefined,
        };
      }),
      faltando: Array.isArray(raw.faltando)
        ? raw.faltando.filter((item): item is string => typeof item === 'string').slice(0, 40)
        : [],
    };

    if (profile.candidates.length === 0) return false;
    await inspectionRepository.addSelectors(profile);
    this.lastSampleAt = profile.timestamp;
    await logEvent({
      tipoEvento: 'INSPECT_SELECTOR_PROFILE',
      nivel: 'INFO',
      origem: 'INSPECAO',
      resultado: `${profile.candidates.length} candidatos`,
    });
    await this.broadcastStatus();
    return true;
  }

  async ingestScreenshot(input: unknown): Promise<boolean> {
    if (!this.shouldCaptureScreenshots()) return false;
    if (typeof input !== 'object' || input === null) return false;
    const raw = input as Record<string, unknown>;
    const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : '';
    if (!dataUrl.startsWith('data:image/')) return false;
    if (dataUrl.length > 3_000_000) return false;

    const timestamp = nowIso();
    await inspectionRepository.addScreenshot(newId('shot'), timestamp, {
      dataUrl,
      context: safeContext(raw.context),
      url: safeString(raw.url, 2_048),
      timestamp,
    });
    this.lastSampleAt = timestamp;
    await this.enforceScreenshotRetention();
    await logEvent({
      tipoEvento: 'INSPECT_SCREENSHOT',
      nivel: 'INFO',
      origem: 'INSPECAO',
      resultado: 'capturada',
    });
    return true;
  }

  async status(): Promise<InspectionStatus> {
    const counts = await inspectionRepository.counts();
    const readiness = await inspectionRepository.readiness();
    return {
      inspectMode: this.inspectMode,
      counts,
      readiness,
      ultimaAmostraEm: this.lastSampleAt,
      poucasAmostras: !readiness.pronto,
    };
  }

  async buildContract(): Promise<CalibrationContract> {
    const [network, dom, selectors] = await Promise.all([
      inspectionRepository.list('network', 2_000) as Promise<NetworkSample[]>,
      inspectionRepository.list('dom', 200) as Promise<DomSample[]>,
      inspectionRepository.list('selectors', 100) as Promise<SelectorProfile[]>,
    ]);
    return analyzeCalibrationContract({ network, dom, selectors });
  }

  async exportBundle(includePii: boolean): Promise<CalibrationBundle> {
    const counts = await inspectionRepository.counts();
    const readiness = await inspectionRepository.readiness();
    const network = (await inspectionRepository.list('network', 400)) as NetworkSample[];
    const dom = (await inspectionRepository.list('dom', 40)) as DomSample[];
    const selectors = (await inspectionRepository.list('selectors', 40)) as SelectorProfile[];
    const contract = analyzeCalibrationContract({ network, dom, selectors });

    const bundle: CalibrationBundle = {
      bundleVersion: 1,
      exportedAt: nowIso(),
      extensionVersion: APP_VERSION,
      appFingerprint: readiness.appFingerprint,
      counts,
      network,
      dom,
      selectors,
      contract,
      piiIncluded: includePii,
    };

    if (!includePii) {
      bundle.network = network.map((sample) => ({
        ...sample,
        requestBody: sample.requestBody ? maskText(sample.requestBody) : sample.requestBody,
        responseBody: sample.responseBody ? maskText(sample.responseBody) : sample.responseBody,
      }));
      bundle.dom = dom.map((sample) => ({ ...sample, html: maskText(sample.html), piiIncluded: false }));
      bundle.notes = 'PII mascarada na exportação.';
    }

    await logEvent({
      tipoEvento: 'EXPORT_GENERATED',
      nivel: 'INFO',
      origem: 'INSPECAO',
      resultado: 'calibration-bundle',
      contexto: { piiIncluded: includePii, counts },
    });
    return bundle;
  }

  async importBundle(bundle: unknown): Promise<{ imported: number }> {
    if (typeof bundle !== 'object' || bundle === null) throw new Error('Bundle inválido.');
    const raw = bundle as Record<string, unknown>;
    if (raw.bundleVersion !== 1) throw new Error('Versão de bundle não suportada.');
    if (!Array.isArray(raw.network)) throw new Error('Bundle sem amostras de rede.');

    let imported = 0;
    const samples: NetworkSample[] = [];
    for (const item of raw.network.slice(0, 2_000)) {
      const sample = this.normalizeNetwork(item, 'IMPORT');
      if (sample) samples.push(sample);
    }
    await inspectionRepository.addNetwork(samples);
    imported += samples.length;

    if (Array.isArray(raw.dom)) {
      for (const item of raw.dom.slice(0, 200)) {
        if (typeof item !== 'object' || item === null) continue;
        const dom = item as Record<string, unknown>;
        const html = typeof dom.html === 'string' ? truncate(dom.html, LIMITS.maxDomBytes) : null;
        if (!html) continue;
        const captureScript = safeCaptureScript(dom.captureScript);
        await inspectionRepository.addDom({
          id: newId('dom'),
          timestamp: safeString(dom.timestamp, 40) || nowIso(),
          context: safeContext(dom.context),
          url: safeString(dom.url, 2_048),
          html: this.includePii ? html.value : maskText(html.value),
          truncated: html.truncated,
          piiIncluded: this.includePii,
          ...(captureScript ? { captureScript } : {}),
        });
        imported++;
      }
    }

    if (Array.isArray(raw.selectors)) {
      for (const item of raw.selectors.slice(0, 200)) {
        await this.ingestSelectors(item);
        imported++;
      }
    }

    await logEvent({
      tipoEvento: 'CALIBRATION_IMPORTED',
      nivel: 'INFO',
      origem: 'INSPECAO',
      resultado: `${imported} amostra(s)`,
    });
    await this.broadcastStatus();
    return { imported };
  }

  async confirm(appFingerprint: string): Promise<CalibrationReadiness> {
    const readiness = await inspectionRepository.confirm(appFingerprint);
    if (!readiness.pronto) {
      throw new Error(`Calibração incompleta: ${readiness.pendencias.join(', ')}`);
    }
    await logEvent({
      tipoEvento: 'CALIBRATION_CONFIRMED',
      nivel: 'INFO',
      origem: 'INSPECAO',
      resultado: 'confirmada',
      contexto: { appFingerprint },
    });
    return readiness;
  }

  async clear(): Promise<void> {
    await inspectionRepository.clear();
    this.lastSampleAt = undefined;
    this.dedupe.clear();
    await this.broadcastStatus();
  }

  countSamples(): Promise<CalibrationCounts> {
    return inspectionRepository.counts();
  }

  private async enforceScreenshotRetention(): Promise<void> {
    const settings = await settingsRepository.get();
    const cutoff = new Date(
      Date.now() - settings.retentionScreenshotsDays * 86_400_000,
    ).toISOString();
    await inspectionRepository.deleteScreenshotsOlderThan(cutoff);
    await inspectionRepository.deleteScreenshotsBeyond(settings.retentionScreenshotsMaxFiles);
  }

  private async broadcastStatus(): Promise<void> {
    try {
      const counts = await inspectionRepository.counts();
      await broadcastToPanel({
        type: 'inspection',
        payload: {
          counts: counts as unknown as Record<string, number>,
          ...(this.lastSampleAt ? { ultimaAmostraEm: this.lastSampleAt } : {}),
        },
      });
    } catch {
      /* painel fechado */
    }
  }

  /** Utilitário usado pelo router para validar o bundle enviado pelo painel. */
  parseBundleJson(text: string): unknown {
    return parseJsonSafe(text);
  }
}

export const inspectionService = new InspectionService();
