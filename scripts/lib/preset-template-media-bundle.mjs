/**
 * 预设模板工程 JSON：将节点内图片/视频/音频引用改写为随包相对路径，并写入 public/flowid-bundled/presets/assets/。
 *
 * 字节来源优先级：resultThumbnails.diskPath（本机路径）→ preset-assets/<assetId>.* → http(s) → data:。
 * blob: 无法在无浏览器环境解析，需先把文件放入 server/templates/preset-assets/。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const CT_EXT = {
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
}

const BUNDLED_PREFIX = 'flowid-bundled/presets/assets'

/**
 * @param {string} templateId
 * @param {string} key
 * @param {string} ext
 */
export function bundledPresetAssetRelPath(templateId, key, ext) {
  const tid = String(templateId || '').trim() || 'unknown'
  const k = String(key || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'asset'
  const e = ext.startsWith('.') ? ext : `.${ext}`
  return `${BUNDLED_PREFIX}/${tid}/${k}${e}`
}

/**
 * @param {string} filePath
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} dir
 * @param {string} assetId
 */
async function findAssetFileById(dir, assetId) {
  const id = String(assetId || '').trim()
  if (!id || !dir) return null
  try {
    const names = await fs.readdir(dir)
    for (const name of names) {
      if (name.startsWith(id + '.') || name === id) {
        const full = path.join(dir, name)
        const st = await fs.stat(full)
        if (st.isFile()) return full
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * @param {string} raw
 */
function extFromUrlOrPath(raw) {
  const s = String(raw || '').split('?')[0].split('#')[0]
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(s)
  if (m) return `.${m[1].toLowerCase()}`
  return '.bin'
}

/**
 * @param {Buffer} buf
 */
function sniffExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return '.png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
  if (buf.length >= 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    return '.webp'
  }
  if (buf.length >= 8 && buf.slice(4, 8).toString() === 'ftyp') return '.mp4'
  return '.bin'
}

/**
 * @param {string} dataUrl
 */
function decodeDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(String(dataUrl || '').trim())
  if (!m) return null
  const ct = String(m[1] || 'application/octet-stream').trim().toLowerCase()
  const b64 = Boolean(m[2])
  const payload = m[3] || ''
  const buf = b64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
  const ext = CT_EXT[ct] || sniffExt(buf)
  return { buf, ext, mime: ct }
}

/**
 * @param {{ url?: string, assetId?: string, diskPath?: string, assetRoot?: string }} slot
 */
async function loadMediaBytes(slot) {
  const url = String(slot.url || '').trim()
  const assetId = String(slot.assetId || '').trim()
  const diskPath = String(slot.diskPath || '').trim()
  const assetRoot = String(slot.assetRoot || '').trim()

  if (diskPath && (await fileExists(diskPath))) {
    const buf = await fs.readFile(diskPath)
    return { buf, ext: extFromUrlOrPath(diskPath) }
  }

  if (assetId && assetRoot) {
    const found = await findAssetFileById(assetRoot, assetId)
    if (found) {
      const buf = await fs.readFile(found)
      return { buf, ext: extFromUrlOrPath(found) }
    }
  }

  if (url.startsWith('data:')) {
    const decoded = decodeDataUrl(url)
    if (decoded) return decoded
  }

  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const buf = Buffer.from(await res.arrayBuffer())
    return { buf, ext: CT_EXT[ct] || sniffExt(buf) }
  }

  if (url.startsWith('blob:')) {
    return null
  }

  if (url && (await fileExists(url))) {
    const buf = await fs.readFile(url)
    return { buf, ext: extFromUrlOrPath(url) }
  }

  return null
}

/**
 * @param {Record<string, unknown>} snapshot
 * @param {string} templateId
 * @param {{ repoRoot: string, assetRoot?: string, publicRoot?: string, log?: (msg: string) => void }} options
 */
export async function bundlePresetWorkflowSnapshot(snapshot, templateId, options) {
  const repoRoot = path.resolve(options.repoRoot)
  const assetRoot = path.resolve(options.assetRoot || path.join(repoRoot, 'server', 'templates', 'preset-assets'))
  const publicRoot = path.resolve(options.publicRoot || path.join(repoRoot, 'public'))
  const log = options.log || (() => {})
  const dedupe = new Map()
  const stats = { bundled: 0, skipped: 0, reused: 0 }

  /**
   * @param {{ url?: string, assetId?: string, diskPath?: string }} slot
   */
  async function bundleOne(slot) {
    const url = String(slot.url || '').trim()
    const assetId = String(slot.assetId || '').trim()
    if (!url && !assetId) return url

    if (url.startsWith(`${BUNDLED_PREFIX}/`)) {
      stats.reused += 1
      return url
    }

    const dedupeKey = assetId || url
    if (dedupe.has(dedupeKey)) {
      stats.reused += 1
      return dedupe.get(dedupeKey)
    }

    const loaded = await loadMediaBytes({ ...slot, assetRoot })
    if (!loaded) {
      stats.skipped += 1
      if (url.startsWith('blob:')) {
        log(`  跳过 blob（请放入 preset-assets/${assetId || '（无 assetId）'}.*）：${url.slice(0, 48)}…`)
      } else if (url || assetId) {
        log(`  跳过无法解析的媒体：assetId=${assetId || '—'} url=${url.slice(0, 60)}`)
      }
      return url
    }

    const key = assetId || crypto.createHash('sha1').update(dedupeKey).digest('hex').slice(0, 16)
    const rel = bundledPresetAssetRelPath(templateId, key, loaded.ext)
    const abs = path.join(publicRoot, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, loaded.buf)
    dedupe.set(dedupeKey, rel)
    stats.bundled += 1
    return rel
  }

  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  for (const node of nodes) {
    const d = node?.data
    if (!d || typeof d !== 'object') continue

    if (typeof d.src === 'string' && (d.src.trim() || d.srcAssetId)) {
      const aid = String(d.srcAssetId || '').trim()
      let diskPath = ''
      if (Array.isArray(d.resultThumbnails)) {
        for (const thumb of d.resultThumbnails) {
          if (!thumb?.diskPath) continue
          const dp = String(thumb.diskPath)
          if (!aid || String(thumb.assetId || '').trim() === aid) {
            diskPath = dp
            break
          }
          if (!diskPath) diskPath = dp
        }
      }
      d.src = await bundleOne({ url: d.src, assetId: d.srcAssetId, diskPath })
    }

    const refUrls = Array.isArray(d.referenceImageSources) ? d.referenceImageSources : []
    const refIds = Array.isArray(d.referenceImageAssetIds) ? d.referenceImageAssetIds : []
    if (refUrls.length) {
      const nextUrls = []
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
        if (typeof thumb.url === 'string') {
          thumb.url = await bundleOne({
            url: thumb.url,
            assetId: thumb.assetId,
            diskPath: thumb.diskPath,
          })
        }
        if (thumb.diskPath) delete thumb.diskPath
      }
    }
  }

  return { snapshot, stats }
}

/**
 * @param {string} workflowText
 * @param {string} templateId
 * @param {Parameters<typeof bundlePresetWorkflowSnapshot>[2]} options
 */
export async function bundlePresetWorkflowJson(workflowText, templateId, options) {
  const snapshot = JSON.parse(workflowText)
  const { snapshot: bundled, stats } = await bundlePresetWorkflowSnapshot(snapshot, templateId, options)
  return {
    json: `${JSON.stringify(bundled, null, 2)}\n`,
    stats,
  }
}
