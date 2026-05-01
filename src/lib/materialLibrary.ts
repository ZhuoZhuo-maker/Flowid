import type { AssetItem, AssetKind } from '../components/panels/types'
import type { LocalDiskPathsSettings } from './localDiskPathsSettings'

/** 与右侧面板分类标签一致的子目录名（不含「全部」）。 */
export const MATERIAL_CATEGORY_FOLDERS = {
  human: '人物',
  scene: '场景',
  prop: '道具',
  audio: '音效',
  other: '其他',
} as const

export type MaterialCategoryId = keyof typeof MATERIAL_CATEGORY_FOLDERS

export type MaterialLibraryTabId = MaterialCategoryId | 'all'

export const FLOWID_MATERIAL_DRAG_MIME = 'application/x-flowid-material'

export type FlowidMaterialDragPayload = {
  nodeId: string
  title: string
  kind: AssetKind
  src: string
}

export function materialLibraryDiskEnabled(paths: LocalDiskPathsSettings): boolean {
  const root = String(paths.materialLibraryPath || '').trim()
  return Boolean(root && typeof window !== 'undefined' && window.flowidDesktop?.readDirectory)
}

export function toFileUrlForMaterial(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`
  }
  return `file://${encodeURI(normalized)}`
}

/**
 * 从扩展名推断图片 MIME，供 readBinaryFile + Blob 在界面中预览（避免 http 页面无法加载 file://）。
 */
export function imageMimeTypeFromPath(filePath: string): string {
  const leaf = filePath.split(/[/\\]/).pop() || ''
  const ext = leaf.includes('.') ? leaf.split('.').pop()?.toLowerCase() || '' : ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}

function inferImageDownloadExtension(src: string, srcFileName?: string): string {
  if (srcFileName) {
    const m = srcFileName.trim().match(/(\.[a-z0-9]{2,5})$/i)
    if (m) return m[1].toLowerCase()
  }
  if (src.startsWith('data:')) {
    const mime = src.match(/^data:([^;,]+)/)?.[1]?.toLowerCase() || ''
    if (mime.includes('jpeg')) return '.jpg'
    if (mime.includes('png')) return '.png'
    if (mime.includes('webp')) return '.webp'
    if (mime.includes('gif')) return '.gif'
    if (mime.includes('bmp')) return '.bmp'
    return '.png'
  }
  if (src.startsWith('blob:')) return '.png'
  try {
    const u = new URL(src, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    const leaf = u.pathname.split('/').pop() || ''
    const m = leaf.match(/\.(png|jpe?g|webp|gif|bmp)$/i)
    if (m) {
      const e = m[1].toLowerCase()
      return e === 'jpeg' ? '.jpg' : `.${e}`
    }
  } catch {
    /* ignore */
  }
  return '.png'
}

/**
 * 图像节点「下载」默认文件名：与节点标题一致，扩展名来自原文件或 URL。
 */
export function imageDownloadFileName(title: string, src: string, srcFileName?: string): string {
  const raw = String(title || '').trim().replace(/\.(png|jpe?g|webp|gif|bmp)$/i, '')
  const base = sanitizeFileBase(raw || '图片')
  const ext = inferImageDownloadExtension(src, srcFileName)
  return `${base}${ext}`
}

function decodeFileUrlToPath(fileUrl: string): string | null {
  try {
    if (!fileUrl.startsWith('file:')) return null
    const u = new URL(fileUrl)
    let p = decodeURIComponent(u.pathname || '')
    if (/^\/[a-zA-Z]:\//.test(p)) {
      p = p.slice(1).replace(/\//g, '\\')
    } else if (p.startsWith('/')) {
      p = p.replace(/\//g, '\\')
    }
    return p || null
  } catch {
    return null
  }
}

function extFromName(name: string): string {
  const m = name.match(/(\.[^.\\/]+)$/)
  return m ? m[1].toLowerCase() : ''
}

export function fileExtensionLower(name: string): string {
  return extFromName(name)
}

function kindFromExt(ext: string): AssetKind | null {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(e)) return 'image'
  if (['mp4', 'webm', 'mov', 'mkv'].includes(e)) return 'video'
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(e)) return 'audio'
  return null
}

export function sanitizeFileBase(name: string): string {
  const noCtrl = Array.from(String(name || ''))
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
  const trimmed = noCtrl
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.+$/, '')
  return trimmed.slice(0, 120) || 'asset'
}

function joinWin(root: string, child: string): string {
  const r = root.replace(/[\\/]+$/, '')
  const c = child.replace(/^[\\/]+/, '')
  return `${r}\\${c}`
}

export async function ensureMaterialLibraryCategoryDirs(
  root: string,
): Promise<{ ok: boolean; error?: string }> {
  const desk = window.flowidDesktop
  if (!desk?.ensureDirectory || !desk?.ensureSubdirectory) {
    return { ok: false, error: 'desktop-fs-unavailable' }
  }
  const ensuredRoot = await desk.ensureDirectory(root.trim())
  if (!ensuredRoot.ok) return { ok: false, error: ensuredRoot.error || 'ensure-root-failed' }
  for (const folder of Object.values(MATERIAL_CATEGORY_FOLDERS)) {
    const sub = await desk.ensureSubdirectory(String(ensuredRoot.path || root.trim()), folder)
    if (!sub.ok) return { ok: false, error: sub.error || `mkdir-${folder}` }
  }
  return { ok: true }
}

export function folderForMaterialTab(tab: MaterialCategoryId | 'all'): string {
  if (tab === 'all') return MATERIAL_CATEGORY_FOLDERS.other
  return MATERIAL_CATEGORY_FOLDERS[tab]
}

/**
 * 扫描素材库根目录下各分类子文件夹中的媒体文件（非递归）。
 */
export async function scanMaterialLibraryFromDisk(root: string): Promise<AssetItem[]> {
  const desk = window.flowidDesktop
  if (!desk?.readDirectory) return []
  const base = root.trim()
  if (!base) return []

  const out: AssetItem[] = []
  for (const [catId, folder] of Object.entries(MATERIAL_CATEGORY_FOLDERS) as Array<
    [MaterialCategoryId, string]
  >) {
    const dir = joinWin(base, folder)
    const res = await desk.readDirectory(dir, { recursive: false, maxFiles: 2000, maxDepth: 0 })
    if (!res?.ok || !Array.isArray(res.files)) continue
    for (const file of res.files) {
      const ext = extFromName(file.name)
      const kind = kindFromExt(ext)
      if (!kind) continue
      out.push({
        id: `disk:${file.path}`,
        name: file.name,
        kind,
        src: toFileUrlForMaterial(file.path),
        createdAt: Number(file.mtimeMs || 0),
        diskPath: file.path,
        materialCategory: catId,
      })
    }
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return out
}

async function readBytesFromSrc(src: string): Promise<ArrayBuffer | null> {
  if (src.startsWith('file:')) {
    const p = decodeFileUrlToPath(src)
    const desk = window.flowidDesktop
    if (!p || !desk?.readBinaryFile) return null
    const r = await desk.readBinaryFile(p)
    return r?.ok && r.data ? r.data : null
  }
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

function pickExtensionForKind(kind: AssetKind, src: string): string {
  const fromUrl = extFromName(src.split('?')[0] || '')
  if (fromUrl && kindFromExt(fromUrl) === kind) return fromUrl
  if (kind === 'image') return '.png'
  if (kind === 'video') return '.mp4'
  return '.mp3'
}

async function uniqueTargetPath(dir: string, base: string, ext: string): Promise<string> {
  const desk = window.flowidDesktop
  const listing = await desk?.readDirectory?.(dir, { recursive: false, maxFiles: 4000, maxDepth: 0 })
  const existing = new Set(
    (listing?.ok && Array.isArray(listing.files) ? listing.files : []).map((f) => f.name.toLowerCase()),
  )
  const tryName = (leaf: string) => !existing.has(leaf.toLowerCase())
  const primary = `${base}${ext}`
  if (tryName(primary)) return joinWin(dir, primary)
  for (let i = 2; i < 200; i += 1) {
    const leaf = `${base}_${i}${ext}`
    if (tryName(leaf)) return joinWin(dir, leaf)
  }
  return joinWin(dir, `${base}_${Date.now()}${ext}`)
}

export async function allocateMaterialLibraryFilePath(
  dir: string,
  preferredBase: string,
  ext: string,
): Promise<string> {
  const base = sanitizeFileBase(preferredBase)
  const dotExt = ext.startsWith('.') ? ext : ext ? `.${ext}` : ''
  return uniqueTargetPath(dir, base, dotExt || '.bin')
}

export function materialLibraryCategoryAbsolutePath(
  root: string,
  tab: MaterialCategoryId | 'all',
): string {
  return joinWin(root.trim(), folderForMaterialTab(tab))
}

/**
 * 将用户选择的文件写入素材库当前分类目录。
 */
export async function writeFilesToMaterialLibrary(opts: {
  root: string
  categoryTab: MaterialCategoryId | 'all'
  files: File[]
}): Promise<{ ok: boolean; error?: string; count: number }> {
  const desk = window.flowidDesktop
  if (!desk?.writeBinaryFile) return { ok: false, error: 'no-binary-write', count: 0 }
  const ensured = await ensureMaterialLibraryCategoryDirs(opts.root)
  if (!ensured.ok) return { ok: false, error: ensured.error, count: 0 }
  const dir = materialLibraryCategoryAbsolutePath(opts.root, opts.categoryTab)
  let count = 0
  for (const file of opts.files) {
    const mime = file.type
    let kind: AssetKind | null = null
    if (mime.startsWith('image/')) kind = 'image'
    if (mime.startsWith('video/')) kind = 'video'
    if (mime.startsWith('audio/')) kind = 'audio'
    if (!kind) continue
    const ext =
      fileExtensionLower(file.name) ||
      pickExtensionForKind(kind, file.name) ||
      (kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.mp3')
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'upload'
    const buf = await file.arrayBuffer()
    if (!buf.byteLength) continue
    const target = await allocateMaterialLibraryFilePath(dir, baseName, ext)
    const w = await desk.writeBinaryFile(target, buf)
    if (!w.ok) return { ok: false, error: w.error || 'write-failed', count }
    count += 1
  }
  return { ok: true, count }
}

/**
 * 将节点媒体写入素材库分类目录，文件名为节点标题 + 合适扩展名。
 */
export async function saveFlowidMaterialPayloadToDisk(opts: {
  root: string
  categoryTab: MaterialCategoryId | 'all'
  payload: FlowidMaterialDragPayload
}): Promise<{ ok: boolean; error?: string }> {
  const desk = window.flowidDesktop
  if (!desk?.writeBinaryFile) return { ok: false, error: 'no-binary-write' }
  const root = opts.root.trim()
  if (!root) return { ok: false, error: 'empty-root' }

  const ensured = await ensureMaterialLibraryCategoryDirs(root)
  if (!ensured.ok) return { ok: false, error: ensured.error }

  const folder = folderForMaterialTab(opts.categoryTab)
  const dir = joinWin(root, folder)
  const ext = pickExtensionForKind(opts.payload.kind, opts.payload.src)
  const base = sanitizeFileBase(opts.payload.title)
  const target = await uniqueTargetPath(dir, base, ext)
  const bytes = await readBytesFromSrc(opts.payload.src)
  if (!bytes?.byteLength) return { ok: false, error: 'read-media-failed' }
  const w = await desk.writeBinaryFile(target, bytes)
  if (!w.ok) return { ok: false, error: w.error || 'write-failed' }
  return { ok: true }
}

export function parseFlowidMaterialDragPayload(dt: DataTransfer | null): FlowidMaterialDragPayload | null {
  if (!dt) return null
  const raw = dt.getData(FLOWID_MATERIAL_DRAG_MIME)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as FlowidMaterialDragPayload
    if (!v || typeof v.nodeId !== 'string' || typeof v.src !== 'string') return null
    if (v.kind !== 'image' && v.kind !== 'video' && v.kind !== 'audio') return null
    return {
      nodeId: v.nodeId,
      title: String(v.title || 'node'),
      kind: v.kind,
      src: String(v.src),
    }
  } catch {
    return null
  }
}

export function setFlowidMaterialDragData(dt: DataTransfer, payload: FlowidMaterialDragPayload): void {
  try {
    dt.setData(FLOWID_MATERIAL_DRAG_MIME, JSON.stringify(payload))
    dt.setData('text/plain', payload.title)
    dt.effectAllowed = 'copy'
  } catch {
    // ignore
  }
}
