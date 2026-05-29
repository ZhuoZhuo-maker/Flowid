import { zipSync } from 'fflate'
import type { Node } from '@xyflow/react'
import type { ProjectSnapshot, StudioNodeData } from '../types'
import { bundledPresetAssetRelPath, isBundledPresetAssetPath } from './bundledPresetAssetPath'
import { readLocalImageAssetBlob } from './localImageAssetStore'
import { loadLocalDiskPathsSettings } from './localDiskPathsSettings'
import { serializeProject } from './persistence'
import { isBundledPresetMediaPath, resolveBundledPresetMediaUrl } from './presetTemplateMediaBundle'
import { saveUserPresetPackage } from './userPresetTemplateStore'

const CT_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
}

export type PresetTemplateBundleStats = {
  bundled: number
  reused: number
  skipped: number
}

export type PresetTemplatePackageManifest = {
  format: 'flowid-preset'
  version: 1
  templateId: string
  name: string
  category: string
  exportedAtMs: number
  mediaStats: PresetTemplateBundleStats
}

function extFromUrlOrPath(raw: string): string {
  const s = String(raw || '').split('?')[0].split('#')[0]
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(s)
  if (m) return `.${m[1].toLowerCase()}`
  return '.bin'
}

function sniffExt(buf: Uint8Array): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return '.png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString() === 'RIFF' &&
    buf.slice(8, 12).toString() === 'WEBP'
  ) {
    return '.webp'
  }
  if (buf.length >= 8 && buf.slice(4, 8).toString() === 'ftyp') return '.mp4'
  return '.bin'
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(String(dataUrl || '').trim())
  if (!m) return null
  const ct = String(m[1] || 'application/octet-stream').trim().toLowerCase()
  const b64 = Boolean(m[2])
  const payload = m[3] || ''
  if (b64) {
    const bin = atob(payload)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    const ext = CT_EXT[ct] || sniffExt(bytes)
    return { bytes, ext }
  }
  const text = decodeURIComponent(payload)
  const enc = new TextEncoder().encode(text)
  return { bytes: enc, ext: CT_EXT[ct] || '.bin' }
}

async function blobToUint8(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

function isSkippableRemotePreviewUrl(url: string): boolean {
  const u = String(url || '').trim()
  if (!u) return false
  if (u.startsWith('/_comfy_local_')) return true
  if (u.includes('/view?') && u.includes('filename=')) return true
  return false
}

/**
 * 浏览器内解析节点媒体字节（IndexedDB / blob / http / data: / 桌面镜像路径）。
 */
async function loadMediaBytesInBrowser(slot: {
  url?: string
  assetId?: string
  diskPath?: string
}): Promise<{ bytes: Uint8Array; ext: string } | null> {
  const url = String(slot.url || '').trim()
  const assetId = String(slot.assetId || '').trim()
  const diskPath = String(slot.diskPath || '').trim()

  if (assetId) {
    const blob = await readLocalImageAssetBlob(assetId)
    if (blob) {
      const bytes = await blobToUint8(blob)
      const ext = CT_EXT[blob.type] || sniffExt(bytes)
      return { bytes, ext }
    }
    const desk = typeof window !== 'undefined' ? window.flowidDesktop : undefined
    const inputBase = loadLocalDiskPathsSettings().inputPath.trim()
    if (desk?.readBinaryFile && inputBase) {
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
      const sep = inputBase.includes('\\') ? '\\' : '/'
      const base = inputBase.replace(/[\\/]+$/, '')
      for (const ext of extCandidates) {
        const filePath = `${base}${sep}flowid-asset-${assetId}${ext}`
        const res = await desk.readBinaryFile(filePath)
        if (res?.ok && res.data?.byteLength) {
          const bytes = new Uint8Array(res.data)
          return { bytes, ext }
        }
      }
    }
  }

  if (diskPath && window.flowidDesktop?.readBinaryFile) {
    const res = await window.flowidDesktop.readBinaryFile(diskPath)
    if (res?.ok && res.data?.byteLength) {
      const bytes = new Uint8Array(res.data)
      return { bytes, ext: extFromUrlOrPath(diskPath) }
    }
  }

  if (url.startsWith('data:')) {
    return decodeDataUrl(url)
  }

  if (isBundledPresetAssetPath(url) || isBundledPresetMediaPath(url)) {
    const abs = resolveBundledPresetMediaUrl(url)
    if (abs && /^https?:\/\//i.test(abs)) {
      try {
        const res = await fetch(abs)
        if (res.ok) {
          const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          const bytes = new Uint8Array(await res.arrayBuffer())
          return { bytes, ext: CT_EXT[ct] || sniffExt(bytes) }
        }
      } catch {
        return null
      }
    }
    if (abs && abs !== url) {
      try {
        const res = await fetch(abs)
        if (res.ok) {
          const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          const bytes = new Uint8Array(await res.arrayBuffer())
          return { bytes, ext: CT_EXT[ct] || extFromUrlOrPath(abs) || sniffExt(bytes) }
        }
      } catch {
        return null
      }
    }
  }

  if (/^https?:\/\//i.test(url) && !isSkippableRemotePreviewUrl(url)) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const bytes = new Uint8Array(await res.arrayBuffer())
      return { bytes, ext: CT_EXT[ct] || sniffExt(bytes) }
    } catch {
      return null
    }
  }

  if (url.startsWith('blob:')) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const bytes = new Uint8Array(await res.arrayBuffer())
      return { bytes, ext: CT_EXT[ct] || sniffExt(bytes) }
    } catch {
      return null
    }
  }

  return null
}

function hashDedupeKey(input: string): string {
  let h = 0
  const s = String(input)
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 将工程快照内媒体改写为随包路径，并收集待写入 zip 的二进制。
 */
export async function bundlePresetSnapshotMediaForExport(
  snapshot: ProjectSnapshot,
  templateId: string,
): Promise<{
  snapshot: ProjectSnapshot
  assetFiles: Map<string, Uint8Array>
  stats: PresetTemplateBundleStats
}> {
  const cloned: ProjectSnapshot = JSON.parse(serializeProject(snapshot)) as ProjectSnapshot
  const assetFiles = new Map<string, Uint8Array>()
  const dedupe = new Map<string, string>()
  const stats: PresetTemplateBundleStats = { bundled: 0, reused: 0, skipped: 0 }

  const bundleOne = async (slot: {
    url?: string
    assetId?: string
    diskPath?: string
  }): Promise<string> => {
    const url = String(slot.url || '').trim()
    const assetId = String(slot.assetId || '').trim()
    if (!url && !assetId) return url

    if (isBundledPresetAssetPath(url)) {
      stats.reused += 1
      if (!assetFiles.has(url)) {
        const loaded = await loadMediaBytesInBrowser({ url, assetId, diskPath: slot.diskPath })
        if (loaded) assetFiles.set(url, loaded.bytes)
      }
      return url
    }

    const dedupeKey = assetId || url
    if (dedupe.has(dedupeKey)) {
      stats.reused += 1
      return dedupe.get(dedupeKey)!
    }

    if (isSkippableRemotePreviewUrl(url) && !assetId) {
      stats.skipped += 1
      return url
    }

    const loaded = await loadMediaBytesInBrowser(slot)
    if (!loaded) {
      stats.skipped += 1
      return url
    }

    const key = assetId || hashDedupeKey(dedupeKey)
    const rel = bundledPresetAssetRelPath(templateId, key, loaded.ext)
    assetFiles.set(rel, loaded.bytes)
    dedupe.set(dedupeKey, rel)
    stats.bundled += 1
    return rel
  }

  const nodes = cloned.nodes as Array<Node<StudioNodeData>>
  for (const node of nodes) {
    const d = node.data as Record<string, unknown>
    if (!d || typeof d !== 'object') continue

    if (typeof d.src === 'string' && (d.src.trim() || d.srcAssetId)) {
      let diskPath = String(d.srcDiskPath || '').trim()
      if (!diskPath && Array.isArray(d.resultThumbnails)) {
        const aid = String(d.srcAssetId || '').trim()
        for (const thumb of d.resultThumbnails) {
          if (!thumb || typeof thumb !== 'object') continue
          const t = thumb as { diskPath?: string; assetId?: string }
          const dp = String(t.diskPath || '').trim()
          if (!dp) continue
          if (!aid || String(t.assetId || '').trim() === aid) {
            diskPath = dp
            break
          }
        }
      }
      d.src = await bundleOne({
        url: d.src,
        assetId: String(d.srcAssetId || ''),
        diskPath,
      })
      if (d.srcDiskPath) delete d.srcDiskPath
    }

    const refUrls = Array.isArray(d.referenceImageSources) ? d.referenceImageSources : []
    const refIds = Array.isArray(d.referenceImageAssetIds) ? d.referenceImageAssetIds : []
    if (refUrls.length) {
      const nextUrls: string[] = []
      for (let i = 0; i < refUrls.length; i += 1) {
        const u = String(refUrls[i] ?? '').trim()
        const aid = String(refIds[i] ?? '').trim()
        nextUrls.push(await bundleOne({ url: u, assetId: aid }))
      }
      d.referenceImageSources = nextUrls
    }

    if (Array.isArray(d.resultThumbnails)) {
      for (const thumb of d.resultThumbnails) {
        if (!thumb || typeof thumb !== 'object') continue
        const t = thumb as { url?: string; assetId?: string; diskPath?: string }
        if (typeof t.url === 'string') {
          t.url = await bundleOne({
            url: t.url,
            assetId: String(t.assetId || ''),
            diskPath: String(t.diskPath || ''),
          })
        }
        if (t.diskPath) delete t.diskPath
      }
    }

    if (Array.isArray(d.resultSources)) {
      const rs = d.resultSources as string[]
      const nextRs: string[] = []
      for (const item of rs) {
        const u = String(item || '').trim()
        if (!u) continue
        nextRs.push(await bundleOne({ url: u }))
      }
      d.resultSources = nextRs
    }

    if (typeof d.compareSrcA === 'string' && d.compareSrcA.trim()) {
      d.compareSrcA = await bundleOne({ url: d.compareSrcA })
    }
    if (typeof d.compareSrcB === 'string' && d.compareSrcB.trim()) {
      d.compareSrcB = await bundleOne({ url: d.compareSrcB })
    }
  }

  return { snapshot: cloned, assetFiles, stats }
}

function safeFileStem(name: string): string {
  return (
    String(name || 'preset')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .slice(0, 80) || 'preset'
  )
}

/**
 * 打包并写入本机「我的预设」库（左侧预设模板立即可用）。
 */
export async function savePresetTemplateToUserLibrary(options: {
  templateId?: string
  name: string
  category?: string
  snapshot: ProjectSnapshot
}): Promise<{ templateId: string; catalogId: string; stats: PresetTemplateBundleStats }> {
  const templateId = String(options.templateId || '').trim() || crypto.randomUUID()
  const name = String(options.name || '未命名预设').trim() || '未命名预设'
  const category = String(options.category || '我的预设').trim() || '我的预设'

  const { snapshot: bundled, assetFiles, stats } = await bundlePresetSnapshotMediaForExport(
    options.snapshot,
    templateId,
  )

  const manifest: PresetTemplatePackageManifest = {
    format: 'flowid-preset',
    version: 1,
    templateId,
    name,
    category,
    exportedAtMs: Date.now(),
    mediaStats: stats,
  }

  const workflowJson = serializeProject(bundled)
  const { catalogId } = await saveUserPresetPackage({
    manifest,
    workflowJson,
    assetFiles,
  })

  return { templateId, catalogId, stats }
}

/**
 * 打包并触发下载 `.flowid-preset.zip`（含 workflow + 媒体资源）。
 */
export async function downloadPresetTemplateZip(options: {
  templateId?: string
  name: string
  category?: string
  snapshot: ProjectSnapshot
}): Promise<{ templateId: string; stats: PresetTemplateBundleStats }> {
  const templateId = String(options.templateId || '').trim() || crypto.randomUUID()
  const name = String(options.name || '未命名预设').trim() || '未命名预设'
  const category = String(options.category || 'custom').trim() || 'custom'

  const { snapshot: bundled, assetFiles, stats } = await bundlePresetSnapshotMediaForExport(
    options.snapshot,
    templateId,
  )

  const manifest: PresetTemplatePackageManifest = {
    format: 'flowid-preset',
    version: 1,
    templateId,
    name,
    category,
    exportedAtMs: Date.now(),
    mediaStats: stats,
  }

  const zipEntries: Record<string, Uint8Array> = {
    'manifest.json': new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    'workflow.json': new TextEncoder().encode(serializeProject(bundled)),
  }

  for (const [rel, bytes] of assetFiles) {
    zipEntries[rel.replace(/^\.?\/+/, '')] = bytes
  }

  const zipped = zipSync(zipEntries, { level: 6 })
  const blob = new Blob([zipped], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFileStem(name)}.flowid-preset.zip`
  a.click()
  URL.revokeObjectURL(url)

  return { templateId, stats }
}
