import type { LexiconJsonPayload, LexiconMetaPayload, SensitiveWord } from './types'
import { CAT_NUM, entryToWord } from './types'

const IDB_NAME = 'flowid_sensitive'
const IDB_STORE = 'lexicon'
const IDB_KEY = 'sensitive_lexicon'

type CachedRow = {
  version: string
  entries: LexiconJsonPayload['entries']
  timestamp: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(): Promise<CachedRow | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const st = tx.objectStore(IDB_STORE)
      const g = st.get(IDB_KEY)
      g.onsuccess = () => resolve((g.result as CachedRow) ?? null)
      g.onerror = () => reject(g.error)
    })
  } catch {
    return null
  }
}

async function idbSet(row: CachedRow): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(IDB_STORE).put(row, IDB_KEY)
  })
}

export async function loadLexiconFromCache(expectedVersion: string | null): Promise<SensitiveWord[] | null> {
  const row = await idbGet()
  if (!row?.entries?.length) return null
  if (expectedVersion && row.version !== expectedVersion) return null
  return row.entries.map(entryToWord)
}

export async function saveLexiconToCache(version: string, entries: LexiconJsonPayload['entries']): Promise<void> {
  await idbSet({ version, entries, timestamp: Date.now() })
}

export async function fetchLexiconMeta(baseUrl: string): Promise<LexiconMetaPayload> {
  const base = baseUrl.replace(/\/?$/, '/')
  const url = `${base}lexicon/sensitive.meta.json`
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`lexicon meta ${res.status}: ${url}`)
  const data = (await res.json()) as LexiconMetaPayload
  if (!data?.version || typeof data.version !== 'string') throw new Error('lexicon meta: invalid json')
  return data
}

export async function fetchLexiconJson(baseUrl: string, cacheBust?: string): Promise<LexiconJsonPayload> {
  const base = baseUrl.replace(/\/?$/, '/')
  const q = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : ''
  const url = `${base}lexicon/sensitive.json${q}`
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`lexicon fetch ${res.status}: ${url}`)
  const data = (await res.json()) as LexiconJsonPayload
  if (!data?.entries || !Array.isArray(data.entries)) throw new Error('lexicon: invalid json')
  return data
}

/** 将运行时词条写回 IndexedDB（版本以 JSON 为准） */
export async function persistFetchedLexicon(data: LexiconJsonPayload): Promise<SensitiveWord[]> {
  const words = data.entries.map(entryToWord)
  await saveLexiconToCache(data.version, data.entries)
  return words
}

export function wordsToJsonEntries(words: readonly SensitiveWord[]): LexiconJsonPayload['entries'] {
  return words.map((w) => ({
    w: w.word,
    lvl: w.level === 'block' ? 1 : 0,
    cat: CAT_NUM[w.category] ?? 5,
  }))
}
