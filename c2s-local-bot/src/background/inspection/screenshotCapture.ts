import type { PageContext } from '../../shared/types/inspection';
import { tabRegistry } from '../messaging/tabs';

export interface ScreenshotInput {
  context: PageContext;
  url: string;
}

/**
 * Screenshot da aba visível.
 *
 * `captureVisibleTab` só enxerga a aba ATIVA da janela. Sem a permissão
 * "tabs" não ativamos a aba do C2S automaticamente — o painel orienta o
 * corretor a deixar a aba do C2S em foco na janela correta.
 */
export async function captureVisibleScreenshot(
  input: ScreenshotInput,
): Promise<{ dataUrl: string; context: PageContext; url: string }> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
    throw new Error('Captura de tela indisponível neste contexto.');
  }

  const tab = tabRegistry.primary();
  const windowId = tab?.windowId ?? null;

  const options: chrome.tabs.CaptureVisibleTabOptions = { format: 'jpeg', quality: 60 };
  const dataUrl =
    windowId !== null
      ? await chrome.tabs.captureVisibleTab(windowId, options)
      : await chrome.tabs.captureVisibleTab(options);

  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('Falha ao capturar a tela da aba.');
  }

  return { dataUrl, context: input.context, url: input.url };
}
