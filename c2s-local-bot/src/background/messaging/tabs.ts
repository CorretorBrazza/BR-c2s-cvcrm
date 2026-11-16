/**
 * Registro das abas com content script ativo.
 *
 * Sem a permissão "tabs" não é possível listar URLs de abas; então aprendemos
 * os tabIds pelos heartbeats enviados pelo próprio content script.
 */
class TabRegistry {
  private tabs = new Map<number, { windowId?: number; url: string; atualizadoEm: number }>();

  register(tabId: number, url: string, windowId?: number): void {
    this.tabs.set(tabId, {
      ...(windowId !== undefined ? { windowId } : {}),
      url: url.slice(0, 2_048),
      atualizadoEm: Date.now(),
    });
  }

  unregister(tabId: number): void {
    this.tabs.delete(tabId);
  }

  list(): Array<{ tabId: number; windowId?: number; url: string }> {
    this.prune();
    return Array.from(this.tabs.entries()).map(([tabId, info]) => ({
      tabId,
      ...(info.windowId !== undefined ? { windowId: info.windowId } : {}),
      url: info.url,
    }));
  }

  primary(): { tabId: number; windowId?: number; url: string } | undefined {
    return this.list().sort((a, b) => (a.url < b.url ? 1 : -1))[0];
  }

  private prune(): void {
    const limite = Date.now() - 5 * 60_000;
    for (const [tabId, info] of this.tabs) {
      if (info.atualizadoEm < limite) this.tabs.delete(tabId);
    }
  }
}

export const tabRegistry = new TabRegistry();

/** Envia uma mensagem para todas as abas conhecidas; ignora abas fechadas. */
export async function sendToContentTabs(message: unknown): Promise<void> {
  const tabs = tabRegistry.list();
  await Promise.allSettled(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.tabId, message).catch(() => {
        tabRegistry.unregister(tab.tabId);
      }),
    ),
  );
}

/**
 * Requisição com resposta para UMA aba. Nunca rejeita e nunca espera para
 * sempre: aba congelada/descartada simplesmente não responde.
 */
export async function requestTab<T>(
  tabId: number,
  message: unknown,
  timeoutMs = 8_000,
): Promise<{ ok: true; data: T } | { ok: false; error: string } | null> {
  try {
    const response = await withTimeout(chrome.tabs.sendMessage(tabId, message), timeoutMs);
    if (!response || typeof response !== 'object') return null;
    return response as { ok: true; data: T } | { ok: false; error: string };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
