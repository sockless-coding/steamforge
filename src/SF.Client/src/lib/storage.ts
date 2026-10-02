// Small persistence helpers. Every access is guarded: storage can be unavailable (private mode, blocked site data).

export const local = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Ignore quota or availability errors; persistence is a convenience.
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // Ignore.
    }
  },
}

const DB_NAME = 'steamforge'
const STORE = 'kv'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** IndexedDB key-value store for larger cached payloads such as the content bundle. */
export const idb = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const db = await openDb()
      return await new Promise<T | undefined>((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
        request.onsuccess = () => resolve(request.result as T | undefined)
        request.onerror = () => reject(request.error)
      })
    } catch {
      return undefined
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // Caching is best-effort.
    }
  },
}
