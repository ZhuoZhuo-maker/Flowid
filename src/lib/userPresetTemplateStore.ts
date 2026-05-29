import type { PresetTemplatePackageManifest } from './exportPresetTemplatePackage'
import { isBundledPresetAssetPath } from './bundledPresetAssetPath'

/** 画布/列表用的 catalog id 前缀，避免与 Auth 模板 id 冲突 */
export const USER_PRESET_CATALOG_ID_PREFIX = 'user-local:'

const DB_NAME = 'flowid.user-presets.v1'
const DB_VERSION = 1
const STORE_META = 'meta'
const STORE_WORKFLOWS = 'workflows'
const STORE_ASSETS = 'assets'

export type UserPresetMeta = {
  templateId: string
  name: string
  category: string
  importedAtMs: number
  exportedAtMs?: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'templateId' })
      if (!db.objectStoreNames.contains(STORE_WORKFLOWS)) db.createObjectStore(STORE_WORKFLOWS)
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打开用户预设库失败'))
  })
}

/** @param {string} catalogId */
export function isUserLocalPresetCatalogId(catalogId: string): boolean {
  return String(catalogId || '').startsWith(USER_PRESET_CATALOG_ID_PREFIX)
}

/** @param {string} catalogId */
export function stripUserLocalPresetCatalogId(catalogId: string): string {
  const id = String(catalogId || '').trim()
  if (!isUserLocalPresetCatalogId(id)) return id
  return id.slice(USER_PRESET_CATALOG_ID_PREFIX.length)
}

/** @param {string} rawTemplateId */
export function toUserLocalPresetCatalogId(rawTemplateId: string): string {
  const rid = String(rawTemplateId || '').trim()
  if (!rid) return ''
  if (isUserLocalPresetCatalogId(rid)) return rid
  return `${USER_PRESET_CATALOG_ID_PREFIX}${rid}`
}

/** 列出本机用户预设元数据（按导入时间倒序） */
export async function listUserPresetMeta(): Promise<UserPresetMeta[]> {
  const db = await openDb()
  try {
    return await new Promise<UserPresetMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly')
      const store = tx.objectStore(STORE_META)
      const req = store.getAll()
      req.onsuccess = () => {
        const rows = (req.result as UserPresetMeta[] | undefined) ?? []
        resolve(
          rows
            .filter((m) => String(m?.templateId || '').trim())
            .sort((a, b) => (b.importedAtMs || 0) - (a.importedAtMs || 0)),
        )
      }
      req.onerror = () => reject(req.error ?? new Error('读取用户预设列表失败'))
    })
  } finally {
    db.close()
  }
}

/**
 * 写入或覆盖一条用户预设（workflow + 随包媒体路径二进制）。
 */
export async function saveUserPresetPackage(options: {
  manifest: PresetTemplatePackageManifest
  workflowJson: string
  assetFiles: Map<string, Uint8Array>
}): Promise<{ catalogId: string }> {
  const templateId = String(options.manifest.templateId || '').trim() || crypto.randomUUID()
  const meta: UserPresetMeta = {
    templateId,
    name: String(options.manifest.name || '未命名预设').trim() || '未命名预设',
    category: String(options.manifest.category || '我的预设').trim() || '我的预设',
    importedAtMs: Date.now(),
    exportedAtMs: options.manifest.exportedAtMs,
  }

  const db = await openDb()
  try {
    const oldAssetKeys = await listAssetKeysForTemplate(db, templateId)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_WORKFLOWS, STORE_ASSETS], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('写入用户预设失败'))

      tx.objectStore(STORE_META).put(meta)
      tx.objectStore(STORE_WORKFLOWS).put(options.workflowJson, templateId)

      const assetStore = tx.objectStore(STORE_ASSETS)
      for (const key of oldAssetKeys) assetStore.delete(key)
      for (const [rel, bytes] of options.assetFiles) {
        const key = `${templateId}::${rel.replace(/^\.?\/+/, '')}`
        assetStore.put(bytes, key)
      }
    })
  } finally {
    db.close()
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('flowid:user-presets-changed'))
  }

  return { catalogId: toUserLocalPresetCatalogId(templateId) }
}

/** @param {string} catalogId */
export async function loadUserPresetWorkflowJson(catalogId: string): Promise<string> {
  const templateId = stripUserLocalPresetCatalogId(catalogId)
  if (!templateId) throw new Error('无效的用户预设 id')

  const db = await openDb()
  try {
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction(STORE_WORKFLOWS, 'readonly')
      const req = tx.objectStore(STORE_WORKFLOWS).get(templateId)
      req.onsuccess = () => {
        const v = req.result
        if (typeof v !== 'string' || !v.trim()) {
          reject(new Error('用户预设 workflow 不存在或已损坏'))
          return
        }
        resolve(v)
      }
      req.onerror = () => reject(req.error ?? new Error('读取用户预设 workflow 失败'))
    })
  } finally {
    db.close()
  }
}

/**
 * 按随包相对路径读取媒体（workflow 内 `flowid-bundled/presets/assets/...`）。
 * @param {string} templateId 不含 user-local: 前缀
 * @param {string} relPath
 */
export async function readUserPresetAssetBlob(
  templateId: string,
  relPath: string,
): Promise<Blob | null> {
  const tid = String(templateId || '').trim()
  const rel = String(relPath || '').trim().replace(/^\.?\/+/, '')
  if (!tid || !rel) return null

  const db = await openDb()
  try {
    const bytes = await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly')
      const req = tx.objectStore(STORE_ASSETS).get(`${tid}::${rel}`)
      req.onsuccess = () => {
        const v = req.result
        resolve(v instanceof Uint8Array ? v : null)
      }
      req.onerror = () => reject(req.error ?? new Error('读取用户预设资源失败'))
    })
    if (!bytes?.length) return null
    const ext = rel.split(/[?#]/)[0]?.toLowerCase() || ''
    const type =
      ext.endsWith('.png')
        ? 'image/png'
        : ext.endsWith('.jpg') || ext.endsWith('.jpeg')
          ? 'image/jpeg'
          : ext.endsWith('.webp')
            ? 'image/webp'
            : ext.endsWith('.mp4')
              ? 'video/mp4'
              : ext.endsWith('.mp3')
                ? 'audio/mpeg'
                : ext.endsWith('.wav')
                  ? 'audio/wav'
                  : ext.endsWith('.flac')
                    ? 'audio/flac'
                    : 'application/octet-stream'
    return new Blob([Uint8Array.from(bytes)], { type })
  } finally {
    db.close()
  }
}

async function listAssetKeysForTemplate(db: IDBDatabase, templateId: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly')
    const store = tx.objectStore(STORE_ASSETS)
    const req = store.getAllKeys()
    req.onsuccess = () => {
      const prefix = `${templateId}::`
      const keys = (req.result as IDBValidKey[]).map((k) => String(k)).filter((k) => k.startsWith(prefix))
      resolve(keys)
    }
    req.onerror = () => reject(req.error ?? new Error('枚举用户预设资源失败'))
  })
}

/** 删除本机用户预设 */
export async function deleteUserPresetTemplate(catalogId: string): Promise<void> {
  const templateId = stripUserLocalPresetCatalogId(catalogId)
  if (!templateId) return

  const db = await openDb()
  try {
    const assetKeys = await listAssetKeysForTemplate(db, templateId)

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_WORKFLOWS, STORE_ASSETS], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('删除用户预设失败'))
      tx.objectStore(STORE_META).delete(templateId)
      tx.objectStore(STORE_WORKFLOWS).delete(templateId)
      const assetStore = tx.objectStore(STORE_ASSETS)
      for (const key of assetKeys) assetStore.delete(key)
    })
  } finally {
    db.close()
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('flowid:user-presets-changed'))
  }
}

/** 判断 URL 是否可能属于用户预设随包路径 */
export function isUserPresetBundledMediaPath(url: string): boolean {
  const u = String(url || '').trim().replace(/^\.?\/+/, '')
  return isBundledPresetAssetPath(u)
}
