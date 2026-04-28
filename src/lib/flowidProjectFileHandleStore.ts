/**
 * 浏览器端：通过 File System Access API 绑定单个「工程 .json」文件句柄，
 * 持久化在 IndexedDB 中，刷新后仍可读写（需用户曾授权且浏览器支持）。
 */

const DB_NAME = 'flowid.project-file-handle.v1'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'flowid-project-json'

/**
 * Chromium File System Access API 在部分 TS DOM 定义中未包含的方法。
 */
type FlowidWritableFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  createWritable?: () => Promise<FileSystemWritableFileStream>
}

/**
 * 打开 IndexedDB。
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打开工程句柄库失败'))
  })
}

/**
 * 当前环境是否支持 `showOpenFilePicker`（Chromium 系一般支持）。
 */
export function browserSupportsFlowidProjectFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

/**
 * 读取已保存的工程文件句柄。
 */
export async function loadStoredFlowidProjectFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb()
    try {
      return await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.get(HANDLE_KEY)
        req.onsuccess = () => {
          const v = req.result
          resolve(v && typeof (v as FileSystemFileHandle).getFile === 'function' ? (v as FileSystemFileHandle) : null)
        }
        req.onerror = () => reject(req.error ?? new Error('读取句柄失败'))
      })
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/**
 * 持久化保存工程文件句柄（需用户手势触发过的合法句柄）。
 */
export async function saveStoredFlowidProjectFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.put(handle, HANDLE_KEY)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('保存句柄失败'))
    })
  } finally {
    db.close()
  }
}

/**
 * 清除已绑定的工程文件句柄。
 */
export async function clearStoredFlowidProjectFileHandle(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.delete(HANDLE_KEY)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('清除句柄失败'))
    })
  } finally {
    db.close()
  }
}

/**
 * 确保对句柄具备读写权限（必要时弹窗向用户申请）。
 */
export async function ensureProjectFileHandleWritable(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  const h = handle as FlowidWritableFileHandle
  if (typeof h.queryPermission !== 'function') return true
  const perm = await h.queryPermission({ mode: 'readwrite' })
  if (perm === 'granted') return true
  if (typeof h.requestPermission !== 'function') return false
  const req = await h.requestPermission({ mode: 'readwrite' })
  return req === 'granted'
}
