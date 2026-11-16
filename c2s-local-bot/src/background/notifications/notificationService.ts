import { APP_NAME } from '../../shared/constants/defaults';
import { logEvent } from '../events/logEvent';

const ICON_URL = 'icons/icon-128.png';
const OFFSCREEN_PATH = 'offscreen.html';

export interface NotifyInput {
  title: string;
  message: string;
  priority?: number;
  silent?: boolean;
  sound?: boolean;
  contextMessage?: string;
}

class NotificationService {
  private creating: Promise<void> | null = null;

  async notify(input: NotifyInput): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.notifications) return;

    try {
      await chrome.notifications.create(`c2s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, {
        type: 'basic',
        iconUrl: ICON_URL,
        title: input.title.slice(0, 120),
        message: input.message.slice(0, 500),
        priority: input.priority ?? 1,
        silent: input.silent ?? true,
        ...(input.contextMessage ? { contextMessage: input.contextMessage.slice(0, 120) } : {}),
      });
    } catch (error) {
      await logEvent({
        tipoEvento: 'INTERNAL_ERROR',
        nivel: 'AVISO',
        origem: 'SISTEMA',
        motivo: `Falha ao exibir notificação: ${error instanceof Error ? error.message : 'desconhecida'}`,
      });
    }

    if (input.sound !== false) await this.playAlert();
  }

  async playAlert(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.offscreen) return;
    try {
      await this.ensureOffscreen();
      await chrome.runtime.sendMessage({ kind: 'offscreen:beep', target: 'offscreen' });
    } catch {
      // Som é acessório: nunca deve gerar erro para o corretor.
    }
  }

  private async ensureOffscreen(): Promise<void> {
    if (this.creating) return this.creating;

    this.creating = (async () => {
      const exists = await this.hasOffscreen();
      if (exists) return;
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_PATH,
          reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
          justification: `${APP_NAME}: tocar alerta sonoro local ao capturar lead do Bolsão.`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/single offscreen|already/i.test(message)) throw error;
      }
    })();

    try {
      await this.creating;
    } finally {
      this.creating = null;
    }
  }

  private async hasOffscreen(): Promise<boolean> {
    const runtime = chrome.runtime as typeof chrome.runtime & {
      getContexts?: (filter: { contextTypes: string[] }) => Promise<Array<{ contextType: string }>>;
    };
    if (typeof runtime.getContexts === 'function') {
      try {
        const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        return contexts.length > 0;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export const notificationService = new NotificationService();
