/**
 * 本地图片资产库（IndexedDB）。
 *
 * 说明：
 * - 仅用于持久化用户本地上传的图片文件，避免 `blob:` URL 在刷新/重启后失效；
 * - 节点数据里只保存 assetId，运行时再还原为可显示的 object URL。
 */
const DB_NAME = 'flowid.local-image-assets.v1'
const STORE_NAME = 'images'

type LocalImageAssetRecord = {
  id: string
  blob: Blob
  createdAt: number
  mimeType: string
  name?: string
}

import { mirrorUploadToInputDir } from './localAssetDiskMirror'
import { loadLocalDiskPathsSettings } from './localDiskPathsSettings'
import { outputMirrorStemWithNodeId } from './outputMirrorStem'

const objectUrlCache = new Map<string, string>()
const inflightUrlTasks = new Map<string, Promise<string | null>>()
/** 绝对磁盘路径 → object URL（输出条缩略图等，避免 Comfy /view 或失效 blob） */
const diskPathObjectUrlCache = new Map<string, string>()
const diskPathObjectUrlInflight = new Map<string, Promise<string | null>>()

/** 某 `blob:` 是否仍由本模块缓存（与其它节点/侧栏共享）；勿随意 revoke，否则多处预览同时失效。 */
export function isBlobUrlHeldInLocalAssetObjectUrlCache(url: string): boolean {
  const t = String(url || '').trim()
  if (!t.startsWith('blob:')) return false
  for (const u of objectUrlCache.values()) {
    if (u === t) return true
  }
  for (const u of diskPathObjectUrlCache.values()) {
    if (u === t) return true
  }
  return false
}

/** 丢弃该资产的 object URL 缓存并 revoke，下次 `getLocalImageAssetObjectUrl` 会从 IDB/磁盘重建。 */
export function bumpLocalImageAssetObjectUrl(assetId: string): void {
  const id = String(assetId || '').trim()
  if (!id) return
  const old = objectUrlCache.get(id)
  if (!old) return
  try {
    URL.revokeObjectURL(old)
  } catch {
    // ignore
  }
  objectUrlCache.delete(id)
}

/** 强制刷新预览 URL（用于 `<audio>` 等资源已失效但 IndexedDB 仍有数据时）。 */
export async function getLocalImageAssetObjectUrlAfterBump(assetId: string): Promise<string | null> {
  bumpLocalImageAssetObjectUrl(assetId)
  return getLocalImageAssetObjectUrl(assetId)
}

/**
 * 依据路径内容选择分隔符并拼接文件名。
 */
function joinPath(basePath: string, fileName: string): string {
  const base = String(basePath || '').trim().replace(/[\\/]+$/, '')
  if (!base) return fileName
  const sep = base.includes('\\') ? '\\' : '/'
  return `${base}${sep}${fileName}`
}

function mimeTypeFromExt(ext: string): string {
  const e = String(ext || '').toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.webp') return 'image/webp'
  if (e === '.gif') return 'image/gif'
  if (e === '.bmp') return 'image/bmp'
  return 'application/octet-stream'
}

/** 任意镜像媒体文件的 MIME（含音视频，供 readBinaryFile + Blob 预览）。 */
function mediaMimeFromAbsolutePath(filePath: string): string {
  const leaf = filePath.split(/[/\\]/).pop() || ''
  const extRaw = leaf.includes('.') ? leaf.split('.').pop()?.toLowerCase() || '' : ''
  const e = extRaw ? `.${extRaw}` : ''
  if (e === '.png') return 'image/png'
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.webp') return 'image/webp'
  if (e === '.gif') return 'image/gif'
  if (e === '.bmp') return 'image/bmp'
  if (e === '.mp4') return 'video/mp4'
  if (e === '.webm') return 'video/webm'
  if (e === '.mov') return 'video/quicktime'
  if (e === '.mkv') return 'video/x-matroska'
  if (e === '.avi') return 'video/x-msvideo'
  if (e === '.wav') return 'audio/wav'
  if (e === '.mp3') return 'audio/mpeg'
  if (e === '.flac') return 'audio/flac'
  if (e === '.ogg') return 'audio/ogg'
  if (e === '.m4a') return 'audio/mp4'
  if (e === '.aac') return 'audio/aac'
  if (e === '.opus') return 'audio/opus'
  if (e === '.bin') return 'application/octet-stream'
  return 'application/octet-stream'
}

/**
 * 输出目录镜像兜底：按“节点标题 + 扩展名”读取本地 output 文件。
 * 支持的命名格式：
 * 1. 节点标题.扩展名 (如 "视频节点1.mp4")
 * 2. 节点标题-时间戳.扩展名 (如 "视频节点1-2024-01-01T00-00-00-000Z.mp4")
 */
async function readDesktopMirroredOutputBlobByStem(
  stem: string,
  mediaKind: 'image' | 'video' | 'audio',
): Promise<Blob | null> {
  const cleanStem = String(stem || '').trim()
  console.log('[Flowid] readDesktopMirroredOutputBlobByStem:', { stem: cleanStem, mediaKind })
  if (!cleanStem) {
    console.log('[Flowid] Empty stem')
    return null
  }
  const desktop = window.flowidDesktop
  if (!desktop?.readBinaryFile) {
    console.log('[Flowid] No readBinaryFile API')
    return null
  }
  const outputPath = loadLocalDiskPathsSettings().outputPath.trim()
  console.log('[Flowid] outputPath:', outputPath)
  if (!outputPath) {
    console.log('[Flowid] outputPath not configured')
    return null
  }

  const extCandidates =
    mediaKind === 'image'
      ? ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']
      : mediaKind === 'video'
        ? ['.mp4', '.webm', '.mov', '.mkv', '.avi']
        : ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.bin']

  for (const ext of extCandidates) {
    const filePath = joinPath(outputPath, `${cleanStem}${ext}`)
    const res = await desktop.readBinaryFile(filePath)
    if (!res?.ok || !res.data || res.data.byteLength <= 0) continue
    return new Blob([res.data], { type: mimeTypeFromExt(ext) })
  }

  const dirResult = await desktop.readDirectory?.(outputPath)
  console.log('[Flowid] readDirectory result:', dirResult?.ok, dirResult?.files?.length)
  if (!dirResult?.ok || !Array.isArray(dirResult.files)) {
    console.log('[Flowid] No files found')
    return null
  }

  const stemLower = cleanStem.toLowerCase()
  console.log('[Flowid] Looking for files starting with:', stemLower)
  const matchedFiles: Array<{ name: string; ext: string; mtimeMs: number }> = []

  for (const entry of dirResult.files) {
    const fileName = String(entry.name || '').trim()
    if (!fileName) continue

    const nameLower = fileName.toLowerCase()
    
    let matchedExt: string | undefined
    for (const ext of extCandidates) {
      if (nameLower.endsWith(ext.toLowerCase())) {
        matchedExt = ext
        break
      }
    }
    if (!matchedExt) continue

    console.log('[Flowid] Checking file:', fileName, 'startsWith:', nameLower.startsWith(stemLower + '-'))

    if (nameLower.startsWith(stemLower + '-')) {
      console.log('[Flowid] Found match:', fileName)
      matchedFiles.push({
        name: fileName,
        ext: matchedExt,
        mtimeMs: Number(entry.mtimeMs || 0),
      })
    }
  }

  console.log('[Flowid] Total matched files:', matchedFiles.length)

  if (matchedFiles.length > 0) {
    matchedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const newest = matchedFiles[0]
    console.log('[Flowid] Selected file:', newest.name)
    const filePath = joinPath(outputPath, newest.name)
    const res = await desktop.readBinaryFile(filePath)
    if (res?.ok && res.data && res.data.byteLength > 0) {
      console.log('[Flowid] File read successfully')
      return new Blob([res.data], { type: mimeTypeFromExt(newest.ext) })
    }
  }

  console.log('[Flowid] No matching file found')
  return null
}

/**
 * 按「标题 + 节点 id」前缀在 output 目录查找镜像（新命名）；无结果时回退旧版仅标题规则。
 */
async function readDesktopMirroredOutputBlobByNode(
  title: string,
  nodeId: string,
  mediaKind: 'image' | 'video' | 'audio',
  /** 旧版仅按标题/节点 id 扫目录时的 stem，与历史 hydrate 一致 */
  legacyStem: string,
): Promise<Blob | null> {
  const cleanStem = outputMirrorStemWithNodeId(title, nodeId)
  console.log('[Flowid] readDesktopMirroredOutputBlobByNode:', { title, nodeId, cleanStem, legacyStem, mediaKind })
  if (!String(nodeId || '').trim()) {
    return readDesktopMirroredOutputBlobByStem(legacyStem, mediaKind)
  }
  const desktop = window.flowidDesktop
  if (!desktop?.readBinaryFile) return null
  const outputPath = loadLocalDiskPathsSettings().outputPath.trim()
  if (!outputPath) return readDesktopMirroredOutputBlobByStem(legacyStem, mediaKind)

  const extCandidates =
    mediaKind === 'image'
      ? ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']
      : mediaKind === 'video'
        ? ['.mp4', '.webm', '.mov', '.mkv', '.avi']
        : ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.bin']

  const dirResult = await desktop.readDirectory?.(outputPath)
  if (!dirResult?.ok || !Array.isArray(dirResult.files)) {
    return readDesktopMirroredOutputBlobByStem(legacyStem, mediaKind)
  }

  const stemLower = cleanStem.toLowerCase()
  const matchedFiles: Array<{ name: string; ext: string; mtimeMs: number }> = []

  for (const entry of dirResult.files) {
    const fileName = String(entry.name || '').trim()
    if (!fileName) continue
    const nameLower = fileName.toLowerCase()
    let matchedExt: string | undefined
    for (const ext of extCandidates) {
      if (nameLower.endsWith(ext.toLowerCase())) {
        matchedExt = ext
        break
      }
    }
    if (!matchedExt) continue
    if (nameLower.startsWith(stemLower + '-')) {
      matchedFiles.push({
        name: fileName,
        ext: matchedExt,
        mtimeMs: Number(entry.mtimeMs || 0),
      })
    }
  }

  if (matchedFiles.length > 0) {
    matchedFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const newest = matchedFiles[0]!
    const filePath = joinPath(outputPath, newest.name)
    const res = await desktop.readBinaryFile(filePath)
    if (res?.ok && res.data && res.data.byteLength > 0) {
      return new Blob([res.data], { type: mimeTypeFromExt(newest.ext) })
    }
  }

  return readDesktopMirroredOutputBlobByStem(legacyStem, mediaKind)
}

/**
 * 桌面端兜底：IndexedDB 不命中时，从用户配置的 inputPath 中读取镜像文件。
 */
async function readDesktopMirroredAssetBlob(assetId: string): Promise<Blob | null> {
  const id = String(assetId || '').trim()
  if (!id) return null
  const desktop = window.flowidDesktop
  if (!desktop?.readBinaryFile) return null
  const inputPath = loadLocalDiskPathsSettings().inputPath.trim()
  if (!inputPath) return null
  const extCandidates = [
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.bmp',
    '.wav',
    '.mp3',
    '.flac',
    '.ogg',
    '.m4a',
    '.aac',
    '.opus',
    '.mp4',
    '.webm',
    '.mov',
    '.bin',
  ]
  for (const ext of extCandidates) {
    const fileName = `flowid-asset-${id}${ext}`
    const filePath = joinPath(inputPath, fileName)
    const res = await desktop.readBinaryFile(filePath)
    if (!res?.ok || !res.data || res.data.byteLength <= 0) continue
    return new Blob([res.data], { type: mediaMimeFromAbsolutePath(filePath) })
  }
  return null
}

/**
 * 打开（或初始化）本地图片资产库。
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'))
  })
}

/**
 * 在指定仓库中读取记录。
 */
function getRecord(db: IDBDatabase, id: string): Promise<LocalImageAssetRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => {
      const rec = req.result as LocalImageAssetRecord | undefined
      resolve(rec ?? null)
    }
    req.onerror = () => reject(req.error ?? new Error('读取图片资产失败'))
  })
}

/**
 * 写入图片资产并返回 assetId。
 */
export async function saveLocalImageAsset(file: File): Promise<string> {
  const db = await openDb()
  try {
    const id = crypto.randomUUID()
    const rec: LocalImageAssetRecord = {
      id,
      blob: file,
      createdAt: Date.now(),
      mimeType: file.type || 'application/octet-stream',
      name: file.name,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.put(rec)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('写入图片资产失败'))
    })
    /**
     * 同步写一份到设置里的「输入」目录（`flowid-asset-{id}.ext`），供桌面端 IndexedDB 未命中或
     * blob 失效时从盘符恢复；与 Comfy `input` 对齐时需用户将输入路径指到该目录。
     */
    void mirrorUploadToInputDir(file, id)
    return id
  } finally {
    db.close()
  }
}

/**
 * 按 assetId 读取 blob。
 */
export async function readLocalImageAssetBlob(assetId: string): Promise<Blob | null> {
  const id = String(assetId || '').trim()
  if (!id) return null
  const db = await openDb()
  try {
    const rec = await getRecord(db, id)
    return rec?.blob ?? null
  } finally {
    db.close()
  }
}

/**
 * 由 assetId 获取可用于 `<img src>` 的 object URL（带内存缓存）。
 */
export async function getLocalImageAssetObjectUrl(assetId: string): Promise<string | null> {
  const id = String(assetId || '').trim()
  if (!id) return null
  const cached = objectUrlCache.get(id)
  if (cached) return cached
  const running = inflightUrlTasks.get(id)
  if (running) return await running
  const task = (async () => {
    const blob = (await readLocalImageAssetBlob(id)) ?? (await readDesktopMirroredAssetBlob(id))
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    objectUrlCache.set(id, url)
    return url
  })()
  inflightUrlTasks.set(id, task)
  try {
    return await task
  } finally {
    inflightUrlTasks.delete(id)
  }
}

/**
 * 按节点标题从本地 output 镜像目录恢复媒体预览 URL（桌面端）。
 */
/**
 * 桌面端：按绝对路径读盘并缓存为 object URL（Electron 内页面无法用 file:// 直链 img/video）。
 */
export async function getDesktopDiskFileObjectUrl(absPath: string): Promise<string | null> {
  const key = String(absPath || '').trim()
  if (!key) return null
  const cached = diskPathObjectUrlCache.get(key)
  if (cached) return cached
  const running = diskPathObjectUrlInflight.get(key)
  if (running) return await running
  const task = (async () => {
    const desktop = window.flowidDesktop
    if (!desktop?.readBinaryFile) return null
    const res = await desktop.readBinaryFile(key)
    if (!res?.ok || !res.data?.byteLength) return null
    const blob = new Blob([res.data], { type: mediaMimeFromAbsolutePath(key) })
    const url = URL.createObjectURL(blob)
    diskPathObjectUrlCache.set(key, url)
    return url
  })()
  diskPathObjectUrlInflight.set(key, task)
  try {
    return await task
  } finally {
    diskPathObjectUrlInflight.delete(key)
  }
}

export async function getDesktopMirroredOutputObjectUrlByStem(
  stem: string,
  mediaKind: 'image' | 'video' | 'audio',
): Promise<string | null> {
  const key = `output:${mediaKind}:${String(stem || '').trim()}`
  const cached = objectUrlCache.get(key)
  if (cached) return cached
  const running = inflightUrlTasks.get(key)
  if (running) return await running
  const task = (async () => {
    const blob = await readDesktopMirroredOutputBlobByStem(stem, mediaKind)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    objectUrlCache.set(key, url)
    return url
  })()
  inflightUrlTasks.set(key, task)
  try {
    return await task
  } finally {
    inflightUrlTasks.delete(key)
  }
}

export async function getDesktopMirroredOutputObjectUrlByNode(
  title: string,
  nodeId: string,
  mediaKind: 'image' | 'video' | 'audio',
  legacyStem: string,
): Promise<string | null> {
  const stemKey = outputMirrorStemWithNodeId(title, nodeId)
  const key = `outputnode:${mediaKind}:${nodeId}:${stemKey}:${legacyStem}`
  const cached = objectUrlCache.get(key)
  if (cached) return cached
  const running = inflightUrlTasks.get(key)
  if (running) return await running
  const task = (async () => {
    const blob = await readDesktopMirroredOutputBlobByNode(title, nodeId, mediaKind, legacyStem)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    objectUrlCache.set(key, url)
    return url
  })()
  inflightUrlTasks.set(key, task)
  try {
    return await task
  } finally {
    inflightUrlTasks.delete(key)
  }
}

/**
 * 可选：释放所有缓存 URL（例如页面卸载时）。
 */
export function revokeAllLocalImageAssetObjectUrls(): void {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url)
  }
  objectUrlCache.clear()
  for (const url of diskPathObjectUrlCache.values()) {
    URL.revokeObjectURL(url)
  }
  diskPathObjectUrlCache.clear()
}
