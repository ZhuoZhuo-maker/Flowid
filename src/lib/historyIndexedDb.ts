import type { HistoryItem } from '../components/panels/types'

const DB_NAME = 'flowid.appdata.v1'
const DB_VERSION = 1
const STORE_NAME = 'kv'
const HISTORY_KEY = 'historyItems'

type KvRecord = {
  key: string
  value: unknown
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('open indexeddb failed'))
  })
}

export async function readHistoryItemsFromIndexedDb(): Promise<HistoryItem[] | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(HISTORY_KEY)
      req.onsuccess = () => {
        const rec = req.result as KvRecord | undefined
        const v = rec?.value
        resolve(Array.isArray(v) ? (v as HistoryItem[]) : null)
      }
      req.onerror = () => reject(req.error ?? new Error('read history from indexeddb failed'))
    })
  } finally {
    db.close()
  }
}

export async function writeHistoryItemsToIndexedDb(items: HistoryItem[]): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const rec: KvRecord = {
        key: HISTORY_KEY,
        value: items,
        updatedAt: Date.now(),
      }
      const req = store.put(rec)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('write history to indexeddb failed'))
    })
  } finally {
    db.close()
  }
}

export async function readKvFromIndexedDb<T = unknown>(key: string): Promise<T | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(String(key || '').trim())
      req.onsuccess = () => {
        const rec = req.result as KvRecord | undefined
        resolve((rec?.value as T | undefined) ?? null)
      }
      req.onerror = () => reject(req.error ?? new Error('read kv from indexeddb failed'))
    })
  } finally {
    db.close()
  }
}

export async function writeKvToIndexedDb<T = unknown>(key: string, value: T): Promise<void> {
  const k = String(key || '').trim()
  if (!k) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const rec: KvRecord = {
        key: k,
        value,
        updatedAt: Date.now(),
      }
      const req = store.put(rec)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('write kv to indexeddb failed'))
    })
  } finally {
    db.close()
  }
}
