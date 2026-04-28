/**
 * 网页端：为「输入 / 输出 / 工作流」目录保存 `FileSystemDirectoryHandle`（IndexedDB），
 * 与 `localDiskPathsSettings` 中的展示文案配合使用（浏览器无法暴露真实磁盘路径字符串）。
 */

const DB_NAME = 'flowid.browser-folder-handles.v1'
const STORE_NAME = 'handles'

/** 与 `LocalDiskPathsSettings` 中目录字段对应（含工程目录）。 */
export type BrowserFolderSlot = 'inputPath' | 'outputPath' | 'workflowPath' | 'flowidProjectJsonPath'

/**
 * 当前环境是否支持 `showDirectoryPicker`（Chromium 系）。
 */
export function browserSupportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/**
 * 打开（或初始化）IndexedDB。
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
    req.onerror = () => reject(req.error ?? new Error('打开浏览器目录句柄库失败'))
  })
}

/**
 * 持久化目录句柄。
 */
export async function saveBrowserFolderHandle(
  slot: BrowserFolderSlot,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.put(handle, slot)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('保存目录句柄失败'))
    })
  } finally {
    db.close()
  }
}

/**
 * 读取已保存的目录句柄。
 */
export async function loadBrowserFolderHandle(slot: BrowserFolderSlot): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb()
    try {
      return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.get(slot)
        req.onsuccess = () => {
          const v = req.result
          resolve(
            v && typeof (v as FileSystemDirectoryHandle).entries === 'function'
              ? (v as FileSystemDirectoryHandle)
              : null,
          )
        }
        req.onerror = () => reject(req.error ?? new Error('读取目录句柄失败'))
      })
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/**
 * 移除某槽位的目录句柄。
 */
export async function clearBrowserFolderHandle(slot: BrowserFolderSlot): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.delete(slot)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('清除目录句柄失败'))
    })
  } finally {
    db.close()
  }
}

/**
 * 将文件名整理为可在 File System Access API 下安全创建的单层文件名。
 */
function sanitizeFsFileName(fileName: string): string {
  const raw = String(fileName || '').trim() || 'file'
  return raw
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*\u0000-\u001F]/g, '-')
    .slice(0, 200)
}

/**
 * 在已授权的目录句柄下创建/覆盖文件并写入二进制（Chrome / Edge 等）。
 *
 * @param dir 目录句柄
 * @param fileName 文件名（不含路径）
 * @param data 文件内容
 */
export async function writeBinaryToDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  data: ArrayBuffer,
): Promise<{ ok: boolean; error?: string }> {
  const safe = sanitizeFsFileName(fileName)
  try {
    const fh = await dir.getFileHandle(safe, { create: true })
    const anyFh = fh as FileSystemFileHandle & {
      createWritable?: () => Promise<FileSystemWritableFileStream>
    }
    if (typeof anyFh.createWritable !== 'function') {
      return { ok: false, error: 'no-createWritable' }
    }
    const stream = await anyFh.createWritable()
    try {
      await stream.write(data)
      await stream.close()
    } catch (e) {
      try {
        await stream.close()
      } catch {
        /* 忽略 */
      }
      throw e
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  }
}

/**
 * 按槽位读取句柄后写入二进制（网页端镜像 input/output 等）。
 */
export async function writeBinaryToBrowserFolderSlot(
  slot: BrowserFolderSlot,
  fileName: string,
  data: ArrayBuffer,
): Promise<{ ok: boolean; error?: string }> {
  const dir = await loadBrowserFolderHandle(slot)
  if (!dir) return { ok: false, error: 'no-directory-handle' }
  return writeBinaryToDirectoryHandle(dir, fileName, data)
}

/**
 * 在已授权目录下写入 UTF-8 文本文件（如工作流 JSON）。
 */
export async function writeUtf8ToDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const enc = new TextEncoder().encode(text)
  const copy = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength)
  return writeBinaryToDirectoryHandle(dir, fileName, copy)
}

/**
 * 按槽位写入 UTF-8 文本。
 */
export async function writeUtf8ToBrowserFolderSlot(
  slot: BrowserFolderSlot,
  fileName: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const dir = await loadBrowserFolderHandle(slot)
  if (!dir) return { ok: false, error: 'no-directory-handle' }
  return writeUtf8ToDirectoryHandle(dir, fileName, text)
}
