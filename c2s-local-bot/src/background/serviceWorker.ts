/// <reference types="chrome" />
import { initBackground } from './index';
import { handleRuntimeMessage, runMaintenance } from './messaging/messageRouter';
import { sessionService } from './session/sessionService';
import type { RuntimeMessage } from '../shared/types/messages';
import { logEvent } from './events/logEvent';
import { windowEngine } from './automation/windowEngine';
import { cvcrmEngine } from './cvcrm/cvcrmEngine';
import { BUILD_MARKER, buildSummary } from '../shared/constants/buildInfo';

const ALARMS = {
  watchdog: 'c2s:watchdog',
  retention: 'c2s:retention',
  license: 'c2s:license',
  windows: 'c2s:windows',
  cvcrm: 'c2s:cvcrm',
} as const;

const PANEL_PATH = 'panel.html';

async function ensureAlarms(): Promise<void> {
  const existing = await chrome.alarms.getAll();
  const has = (name: string) => existing.some((alarm) => alarm.name === name);

  if (!has(ALARMS.watchdog)) {
    // 30s é o menor período realista aceito pelo Chrome (mínimo 30s).
    chrome.alarms.create(ALARMS.watchdog, { periodInMinutes: 0.5 });
  }
  if (!has(ALARMS.retention)) {
    chrome.alarms.create(ALARMS.retention, { periodInMinutes: 60 * 24 });
  }
  if (!has(ALARMS.license)) {
    chrome.alarms.create(ALARMS.license, { periodInMinutes: 60 * 6 });
  }
  if (!has(ALARMS.windows)) {
    // Mesmo ritmo do watchdog: o menor período realista do Chrome é 30s.
    // Cada tick revalida sessão/calibração/guard antes de agir.
    chrome.alarms.create(ALARMS.windows, { periodInMinutes: 0.5 });
  }
  if (!has(ALARMS.cvcrm)) {
    // Detecção em toast é instantânea (o content avisa); este alarme é o
    // "relógio de segurança" do CV CRM — e o único caminho no modo KANBAN.
    chrome.alarms.create(ALARMS.cvcrm, { periodInMinutes: 0.5 });
  }
}

async function openPanelTab(): Promise<void> {
  const url = chrome.runtime.getURL(PANEL_PATH);
  try {
    const runtime = chrome.runtime as typeof chrome.runtime & {
      getContexts?: (filter: { contextTypes: string[] }) => Promise<Array<{ tabId?: number }>>;
    };
    if (typeof runtime.getContexts === 'function') {
      const contexts = await runtime.getContexts({ contextTypes: ['TAB'] });
      const existing = contexts.find((context) => typeof context.tabId === 'number');
      if (existing?.tabId !== undefined) {
        await chrome.tabs.update(existing.tabId, { active: true });
        const tab = await chrome.tabs.get(existing.tabId);
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        return;
      }
    }
  } catch {
    /* segue para abrir uma nova aba */
  }
  await chrome.tabs.create({ url });
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await initBackground();
    await ensureAlarms();
    if (details.reason === 'install') {
      await logEvent({
        tipoEvento: 'EXTENSION_STARTED',
        nivel: 'INFO',
        origem: 'SISTEMA',
        resultado: 'instalada',
      });
      await openPanelTab();
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await initBackground();
    await ensureAlarms();
    windowEngine.tick();
    cvcrmEngine.tick();
  })();
});

chrome.action.onClicked.addListener(() => {
  void openPanelTab();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    await initBackground();
    if (alarm.name === ALARMS.watchdog) {
      const snapshot = sessionService.get();
      if (!snapshot.conectado && snapshot.abaC2sAberta) {
        await sessionService.markDisconnected();
      }
      return;
    }
    if (alarm.name === ALARMS.retention) {
      await runMaintenance();
    }
    if (alarm.name === ALARMS.license) {
      await runMaintenance();
    }
    if (alarm.name === ALARMS.windows) {
      windowEngine.tick();
    }
    if (alarm.name === ALARMS.cvcrm) {
      cvcrmEngine.tick();
    }
  })();
});

/**
 * Aba do lead fechada sem a página recarregar na etapa alvo: o movimento não
 * foi provado. Falha fechada — o lead continua como está e o corretor é avisado.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    await initBackground();
    await cvcrmEngine.onTabRemoved(tabId);
  })();
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse: (response: unknown) => void) => {
    void (async () => {
      await initBackground();
      const response = await handleRuntimeMessage(message, sender);
      sendResponse(response);
    })();
    // Mantém o canal aberto para a resposta assíncrona.
    return true;
  },
);

// Garante alarms mesmo quando o worker acorda por mensagem (sem reinstalar).
void initBackground().then(ensureAlarms);

// Prova, no console do service worker, o que este bundle realmente contém.
// Se "automação: desligada" aparecer num build que deveria agir, o problema é
// de build — não de C2S, seletor ou licença. A `BUILD_MARKER` é verificada
// também por scripts/build.mjs depois de gerar o pacote.
console.info(`[c2s] ${BUILD_MARKER} · ${buildSummary()}`);
