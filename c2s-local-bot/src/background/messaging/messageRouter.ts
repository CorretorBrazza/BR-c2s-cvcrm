import type {
  DataQuery,
  PanelQueryResultMap,
  RuntimeMessage,
  RuntimeResponse,
} from '../../shared/types/messages';
import type { PageContext } from '../../shared/types/inspection';
import type { EventLevel, EventOrigin, EventType } from '../../shared/types/eventLog';
import type { SettingsPatch } from '../../shared/types/settings';
import { APP_VERSION } from '../../shared/constants/defaults';
import { nowIso } from '../../shared/utils/dateUtils';
import { newId } from '../../shared/utils/idGenerator';
import { stableHash } from '../../shared/utils/validation';
import { logEvent } from '../events/logEvent';
import { inspectionService } from '../inspection/inspectionService';
import { captureVisibleScreenshot } from '../inspection/screenshotCapture';
import { licenseService } from '../license/licenseService';
import { metricsService } from '../metrics/metricsService';
import { sendToContentTabs, tabRegistry } from './tabs';
import { sessionService } from '../session/sessionService';
import { actionQueue } from '../queue/actionQueue';
import { retentionService } from '../retention/retentionService';
import { dbClear } from '../storage/indexedDb';
import { settingsRepository } from '../storage/repositories/settingsRepository';
import { eventLogRepository } from '../storage/repositories/eventLogRepository';
import { leadRepository } from '../storage/repositories/leadRepository';
import { templateRepository } from '../storage/repositories/templateRepository';
import { inspectionRepository } from '../storage/repositories/inspectionRepository';
import { windowEngine } from '../automation/windowEngine';
import { cvcrmEngine } from '../cvcrm/cvcrmEngine';

function ok<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function fail(error: unknown): RuntimeResponse {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function fingerprint(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  return `${APP_VERSION}:${stableHash(ua)}`;
}

async function broadcastMode(): Promise<void> {
  const settings = await settingsRepository.get();
  await sendToContentTabs({
    kind: 'content:mode',
    payload: {
      inspectMode: settings.inspectMode,
      captureScreenshots: settings.inspectCaptureScreenshots,
    },
  });
}

async function handleQuery(query: DataQuery): Promise<PanelQueryResultMap[keyof PanelQueryResultMap]> {
  switch (query.type) {
    case 'settings':
      return settingsRepository.get();
    case 'logs':
      return eventLogRepository.list({
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.filters ? { filters: query.filters } : {}),
      });
    case 'leads':
      return leadRepository.list({
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.filters ? { filters: query.filters } : {}),
      });
    case 'lead':
      return (await leadRepository.get(query.id)) ?? null;
    case 'metrics':
      return metricsService.snapshot();
    case 'metrics:daily':
      return metricsService.daily(query.desde, query.ate);
    case 'inspection:status':
      return inspectionService.status();
    case 'inspection:samples':
      return inspectionRepository.list(query.kind, Math.min(query.limit ?? 100, 400));
    case 'calibration:readiness':
      return inspectionRepository.readiness();
    case 'calibration:contract':
      return inspectionService.buildContract();
    case 'license':
      return licenseService.getState();
    case 'session': {
      const session = sessionService.get();
      return {
        conectado: session.conectado,
        contexto: session.contexto,
        ...(session.url ? { url: session.url } : {}),
        ...(session.atualizadoEm ? { atualizadoEm: session.atualizadoEm } : {}),
      };
    }
    case 'connection': {
      const session = sessionService.get();
      return {
        conectado: session.conectado,
        abaC2sAberta: session.abaC2sAberta,
        ...(session.ultimoPingEm ? { ultimoPingEm: session.ultimoPingEm } : {}),
      };
    }
    case 'templates':
      return templateRepository.list();
    case 'windows':
      return windowEngine.overview();
    case 'windows:audit':
      return windowEngine.audit();
    case 'cvcrm':
      return cvcrmEngine.overview();
    default:
      throw new Error('Consulta desconhecida.');
  }
}

function senderInfo(sender: chrome.runtime.MessageSender): {
  tabId?: number;
  windowId?: number;
} {
  return {
    ...(sender.tab?.id !== undefined ? { tabId: sender.tab.id } : {}),
    ...(sender.tab?.windowId !== undefined ? { windowId: sender.tab.windowId } : {}),
  };
}

function validContext(value: unknown): PageContext {
  const contexts: PageContext[] = ['CONTACTS_LIST', 'BUCKET', 'LEAD_DETAIL', 'LOGIN', 'UNKNOWN'];
  return contexts.includes(value as PageContext) ? (value as PageContext) : 'UNKNOWN';
}

export async function handleRuntimeMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  try {
    switch (message.kind) {
      case 'ping':
        return ok({ pong: true, at: nowIso(), version: APP_VERSION });

      case 'panel:query':
        return ok(await handleQuery(message.payload));

      case 'settings:update': {
        const before = await settingsRepository.get();
        const next = await settingsRepository.patch(message.payload as SettingsPatch);
        inspectionService.applySettings(next);

        if (next.licenseKey !== before.licenseKey) {
          await licenseService.validate({
            licenseKey: next.licenseKey,
            offlineLicenseToleranceHours: next.offlineLicenseToleranceHours,
          });
        }
        if (next.inspectMode !== before.inspectMode) {
          await broadcastMode();
        }
        await logEvent({
          tipoEvento: 'SETTINGS_UPDATED',
          nivel: 'INFO',
          origem: 'PAINEL',
          resultado: 'ok',
          contexto: { campos: Object.keys(message.payload) },
        });
        return ok(next);
      }

      case 'bot:toggle': {
        const next = await settingsRepository.patch({ botActive: message.payload.active });
        await logEvent({
          tipoEvento: message.payload.active ? 'USER_RESUMED' : 'USER_PAUSED',
          nivel: 'INFO',
          origem: 'PAINEL',
          resultado: 'ok',
        });
        return ok(next);
      }

      case 'inspection:set': {
        const next = await settingsRepository.patch({ inspectMode: message.payload.enabled });
        inspectionService.applySettings(next);
        await broadcastMode();
        await logEvent({
          tipoEvento: message.payload.enabled ? 'INSPECT_MODE_ENABLED' : 'INSPECT_MODE_DISABLED',
          nivel: 'INFO',
          origem: 'INSPECAO',
          resultado: 'ok',
        });
        return ok(next);
      }

      case 'inspection:screenshot:request': {
        if (!inspectionService.shouldCaptureScreenshots()) {
          return fail('Captura de tela desativada nas configurações.');
        }
        const session = sessionService.get();
        const shot = await captureVisibleScreenshot({
          context: session.contexto,
          url: session.url ?? '',
        });
        await inspectionService.ingestScreenshot(shot);
        return ok({ captured: true });
      }

      case 'inspection:capture-dom':
        await sendToContentTabs({ kind: 'content:capture-dom' });
        return ok({ requested: true });

      case 'inspection:profile-selectors':
        await sendToContentTabs({ kind: 'content:profile-selectors' });
        return ok({ requested: true });

      case 'calibration:export':
        return ok(await inspectionService.exportBundle(message.payload.includePii));

      case 'calibration:import':
        return ok(await inspectionService.importBundle(message.payload.bundle));

      case 'calibration:confirm': {
        const readiness = await inspectionService.confirm(fingerprint());
        const settings = await settingsRepository.patch({
          calibrationConfirmedAt: readiness.confirmedAt || nowIso(),
          calibrationAppFingerprint: readiness.appFingerprint,
        });
        return ok({ readiness, settings });
      }

      case 'data:clear': {
        const scope = message.payload.scope;
        if (scope === 'inspection' || scope === 'all') {
          await inspectionService.clear();
        }
        if (scope === 'logs' || scope === 'all') {
          await eventLogRepository.clear();
        }
        if (scope === 'all') {
          await dbClear('leads');
          await dbClear('lead_actions');
          await dbClear('daily_metrics');
          await dbClear('monthly_metrics');
          await actionQueue.clear();
          await windowEngine.clear('all');
          await cvcrmEngine.limpar();
        }
        await logEvent({
          tipoEvento: 'DATA_CLEARED',
          nivel: 'AVISO',
          origem: 'PAINEL',
          resultado: scope,
        });
        return ok({ cleared: scope });
      }

      case 'template:save': {
        const payload = message.payload;
        const saved = payload.templateId
          ? await templateRepository.update(payload.templateId, {
              nome: payload.nome,
              tipo: payload.tipo,
              conteudo: payload.conteudo,
            })
          : await templateRepository.create({
              nome: payload.nome,
              tipo: payload.tipo,
              conteudo: payload.conteudo,
            });
        return ok(saved);
      }

      case 'template:delete':
        await templateRepository.remove(message.payload.templateId);
        return ok({ deleted: true });

      /* ------------------------- content script ------------------------- */

      case 'insp:network': {
        const info = senderInfo(sender);
        const count = await inspectionService.ingestNetwork(message.payload, info.tabId);
        return ok({ stored: count });
      }

      case 'insp:dom':
        return ok({ stored: await inspectionService.ingestDom(message.payload) });

      case 'insp:selectors':
        return ok({ stored: await inspectionService.ingestSelectors(message.payload) });

      case 'insp:screenshot':
        return ok({ stored: await inspectionService.ingestScreenshot(message.payload) });

      case 'page:context': {
        const info = senderInfo(sender);
        if (info.tabId !== undefined) {
          tabRegistry.register(info.tabId, message.payload.url, info.windowId);
        }
        await sessionService.update({
          ...info,
          url: message.payload.url,
          context: validContext(message.payload.context),
          sessaoValida: message.payload.sessaoValida,
        });
        await logEvent({
          tipoEvento: message.payload.sessaoValida ? 'C2S_PAGE_DETECTED' : 'C2S_SESSION_EXPIRED',
          nivel: 'INFO',
          origem: 'PAGINA',
          resultado: message.payload.context,
          contexto: { url: message.payload.url },
        });
        const settings = await settingsRepository.get();
        return ok({ inspectMode: settings.inspectMode });
      }

      case 'page:heartbeat': {
        const info = senderInfo(sender);
        if (info.tabId !== undefined) {
          tabRegistry.register(info.tabId, message.payload.url, info.windowId);
        }
        await sessionService.update({
          ...info,
          url: message.payload.url,
          context: validContext(message.payload.context),
          sessaoValida: message.payload.sessaoValida,
        });
        const settings = await settingsRepository.get();
        return ok({
          inspectMode: settings.inspectMode,
          captureScreenshots: settings.inspectCaptureScreenshots,
        });
      }

      case 'windows:tick':
        windowEngine.tick();
        return ok({ started: true });

      case 'windows:interaction': {
        const confirmed = await windowEngine.confirmInteraction(
          message.payload.c2sLeadId,
          message.payload.evidencia,
        );
        return ok({ confirmed });
      }

      case 'windows:clear':
        return ok({ removed: await windowEngine.clear(message.payload.scope) });

      case 'windows:signal':
        // O content script avisa que o DOM mudou; o tick é quem decide. Nada
        // de agir direto na mensagem: o engine revalida sessão, calibração e
        // guard antes de qualquer ação.
        windowEngine.tick();
        return ok({ scheduled: true });

      /* ------------------------------ CV CRM ---------------------------- */

      case 'cvcrm:page': {
        const info = senderInfo(sender);
        if (info.tabId !== undefined) {
          tabRegistry.register(info.tabId, message.payload.url, info.windowId);
          await cvcrmEngine.onPageReport(info.tabId, message.payload);
        }
        return ok({ registrado: info.tabId !== undefined });
      }

      case 'cvcrm:kanban': {
        const info = senderInfo(sender);
        if (info.tabId !== undefined) {
          tabRegistry.register(info.tabId, message.payload.url, info.windowId);
        }
        await cvcrmEngine.onKanban(message.payload);
        return ok({ recebido: message.payload.leads.length });
      }

      case 'cvcrm:baseline':
        return ok(await cvcrmEngine.definirBaseline());

      case 'cvcrm:tick':
        cvcrmEngine.tick();
        return ok({ agendado: true });

      case 'cvcrm:reset':
        await cvcrmEngine.limpar();
        return ok({ limpo: true });

      case 'log:event': {
        const payload = message.payload;
        await logEvent({
          tipoEvento: payload.tipoEvento as EventType,
          nivel: (payload.nivel ?? 'INFO') as EventLevel,
          origem: (payload.origem as EventOrigin | undefined) ?? 'PAGINA',
          endpoint: payload.endpoint,
          metodoHttp: payload.metodoHttp,
          statusHttp: payload.statusHttp,
          resultado: payload.resultado,
          motivo: payload.motivo,
          seletorUsado: payload.seletorUsado,
          acaoExecutada: payload.acaoExecutada,
          duracaoMs: payload.duracaoMs,
          c2sLeadId: payload.c2sLeadId,
          contexto: payload.contexto,
        });
        return ok({ logged: true });
      }

      default:
        return fail(`Mensagem não suportada: ${(message as { kind?: string }).kind ?? '?'}`);
    }
  } catch (error) {
    await logEvent({
      tipoEvento: 'INTERNAL_ERROR',
      nivel: 'ERRO',
      origem: 'SISTEMA',
      motivo: `Falha ao tratar mensagem ${message.kind}: ${error instanceof Error ? error.message : 'desconhecida'}`,
    });
    return fail(error);
  }
}

/** Ações periódicas executadas pelos alarmes. */
export async function runMaintenance(): Promise<void> {
  await retentionService.run();
  const settings = await settingsRepository.get();
  if (settings.licenseKey) await licenseService.refresh(settings);
  const session = sessionService.get();
  if (!session.conectado) await sessionService.markDisconnected();
}

export function newRequestId(): string {
  return newId('req');
}
