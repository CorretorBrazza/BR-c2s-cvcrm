import { DB_NAME, DB_VERSION, MIGRATIONS, type StoreDefinition, type StoreName } from './migrations';

let dbPromise: Promise<IDBDatabase> | null = null;

function applyStores(db: IDBDatabase, stores: StoreDefinition[]): void {
  for (const def of stores) {
    const store = db.objectStoreNames.contains(def.name)
      ? null
      : db.createObjectStore(def.name, { keyPath: def.keyPath });

    if (!store) continue;
    for (const index of def.indexes ?? []) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
      }
    }
  }
}

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponível neste contexto.'));
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const migration of MIGRATIONS) {
        if (event.oldVersion < migration.version) {
          applyStores(db, migration.stores);
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir IndexedDB.'));
    request.onblocked = () =>
      reject(new Error('IndexedDB bloqueado por outra versão da extensão. Feche outras abas.'));
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha em request IndexedDB.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Falha em transação IndexedDB.'));
    tx.onabort = () => reject(tx.error ?? new Error('Transação IndexedDB abortada.'));
  });
}

export async function dbPut<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value as unknown as object);
  await txDone(tx);
}

export async function dbBulkPut<T>(store: StoreName, values: T[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  const objectStore = tx.objectStore(store);
  for (const value of values) objectStore.put(value as unknown as object);
  await txDone(tx);
}

export async function dbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readonly');
  const result = await requestToPromise(tx.objectStore(store).get(key));
  return result as T | undefined;
}

export async function dbGetByIndex<T>(
  store: StoreName,
  index: string,
  value: IDBValidKey,
): Promise<T | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readonly');
  const result = await requestToPromise(tx.objectStore(store).index(index).get(value));
  return result as T | undefined;
}

export async function dbGetAll<T>(store: StoreName, limit?: number): Promise<T[]> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readonly');
  const result = await requestToPromise(tx.objectStore(store).getAll(undefined, limit));
  return result as T[];
}

export async function dbGetAllByIndex<T>(
  store: StoreName,
  index: string,
  value: IDBValidKey,
  limit?: number,
): Promise<T[]> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readonly');
  const result = await requestToPromise(tx.objectStore(store).index(index).getAll(value, limit));
  return result as T[];
}

/** Lê um índice em ordem decrescente (ex.: criadoEm). */
export async function dbQueryDesc<T>(
  store: StoreName,
  index: string,
  options: { limit?: number; upperBound?: IDBValidKey } = {},
): Promise<T[]> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readonly');
  const objectStore = tx.objectStore(store);
  const idx = objectStore.index(index);
  const range = options.upperBound !== undefined ? IDBKeyRange.upperBound(options.upperBound) : null;
  const results: T[] = [];

  await new Promise<void>((resolve, reject) => {
    const request = idx.openCursor(range, 'prev');
    request.onerror = () => reject(request.error ?? new Error('Falha ao ler índice.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      results.push(cursor.value as T);
      if (options.limit && results.length >= options.limit) {
        resolve();
        return;
      }
      cursor.continue();
    };
  });

  return results;
}

export async function dbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await txDone(tx);
}

export async function dbCount(store: StoreName): Promise<number> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).count());
}

export async function dbDeleteByIndexBefore(
  store: StoreName,
  index: string,
  isoCutoff: string,
): Promise<number> {
  const db = await openDatabase();
  const tx = db.transaction(store, 'readwrite');
  const idx = tx.objectStore(store).index(index);
  const range = IDBKeyRange.upperBound(isoCutoff);
  let deleted = 0;

  await new Promise<void>((resolve, reject) => {
    const request = idx.openCursor(range);
    request.onerror = () => reject(request.error ?? new Error('Falha ao limpar índice.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      deleted++;
      cursor.continue();
    };
  });

  await txDone(tx);
  return deleted;
}
