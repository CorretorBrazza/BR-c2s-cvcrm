const memory = new Map<string, unknown>();

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function storageGet<T>(key: string): Promise<T | undefined> {
  if (!hasChromeStorage()) return memory.get(key) as T | undefined;
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  if (!hasChromeStorage()) {
    memory.set(key, value);
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

export async function storageRemove(key: string): Promise<void> {
  if (!hasChromeStorage()) {
    memory.delete(key);
    return;
  }
  await chrome.storage.local.remove(key);
}

export async function storageGetAll(): Promise<Record<string, unknown>> {
  if (!hasChromeStorage()) return Object.fromEntries(memory.entries());
  return chrome.storage.local.get(null);
}

export async function storageClear(): Promise<void> {
  if (!hasChromeStorage()) {
    memory.clear();
    return;
  }
  await chrome.storage.local.clear();
}
