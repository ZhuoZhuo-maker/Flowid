import { getDesktopDiskFileObjectUrl, getLocalImageAssetObjectUrl, saveLocalImageAsset } from './localImageAssetStore'

function safeAudioFileBase(raw: string): string {
  const s = String(raw || 'audio')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .trim()
  return (s || 'audio').slice(0, 48)
}

const KNOWN_AUDIO_EXT = new Set([
  'wav',
  'mp3',
  'flac',
  'ogg',
  'm4a',
  'aac',
  'opus',
  'webm',
])

/** Comfy `/view?filename=xxx.flac` 等；失败返回空 */
function filenameFromViewUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
    return String(u.searchParams.get('filename') || '').trim()
  } catch {
    const m = raw.match(/[?&]filename=([^&]+)/i)
    if (!m?.[1]) return ''
    try {
      return decodeURIComponent(m[1]).trim()
    } catch {
      return m[1].trim()
    }
  }
}

function extFromFilename(fn: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(String(fn || '').trim())
  return m ? m[1].toLowerCase() : ''
}

function mimeForAudioExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'flac':
      return 'audio/flac'
    case 'wav':
      return 'audio/wav'
    case 'mp3':
      return 'audio/mpeg'
    case 'ogg':
      return 'audio/ogg'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'opus':
      return 'audio/opus'
    case 'webm':
      return 'audio/webm'
    default:
      return 'application/octet-stream'
  }
}

/**
 * 从 Content-Type 推断扩展名；`application/octet-stream` 等返回空，避免误当成 mp3。
 */
function extFromBlobType(ct: string): string {
  const t = String(ct || '').toLowerCase().trim()
  if (!t || t === 'application/octet-stream' || t === 'binary/octet-stream') return ''
  if (t.includes('wav')) return 'wav'
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3'
  if (t.includes('flac')) return 'flac'
  if (t.includes('mp4') || t.includes('m4a')) return 'm4a'
  if (t.includes('ogg')) return 'ogg'
  if (t.includes('aac')) return 'aac'
  if (t.includes('opus')) return 'opus'
  if (t.includes('webm')) return 'webm'
  return ''
}

/** 根据文件头判断真实容器（Comfy 常把 FLAC 标成 octet-stream） */
function sniffAudioContainer(buf: ArrayBuffer): { ext: string; mime: string } | null {
  const v = new Uint8Array(buf.byteLength < 64 ? buf : buf.slice(0, 64))
  if (v.length < 4) return null
  if (v[0] === 0x66 && v[1] === 0x4c && v[2] === 0x61 && v[3] === 0x63) {
    return { ext: 'flac', mime: 'audio/flac' }
  }
  if (
    v.length >= 12 &&
    v[0] === 0x52 &&
    v[1] === 0x49 &&
    v[2] === 0x46 &&
    v[3] === 0x46 &&
    v[8] === 0x57 &&
    v[9] === 0x41 &&
    v[10] === 0x56 &&
    v[11] === 0x45
  ) {
    return { ext: 'wav', mime: 'audio/wav' }
  }
  if (v[0] === 0xff && (v[1] & 0xe0) === 0xe0) {
    return { ext: 'mp3', mime: 'audio/mpeg' }
  }
  if (v[0] === 0x49 && v[1] === 0x44 && v[2] === 0x33) {
    return { ext: 'mp3', mime: 'audio/mpeg' }
  }
  if (v[0] === 0x4f && v[1] === 0x67 && v[2] === 0x67 && v[3] === 0x53) {
    return { ext: 'ogg', mime: 'audio/ogg' }
  }
  return null
}

function resolveAudioExtAndMime(args: {
  buf: ArrayBuffer
  blobType: string
  sourceUrl: string
}): { ext: string; mime: string } {
  const sniffed = sniffAudioContainer(args.buf)
  if (sniffed) return sniffed
  const fn = filenameFromViewUrl(args.sourceUrl)
  const fromFn = extFromFilename(fn)
  if (fromFn && KNOWN_AUDIO_EXT.has(fromFn)) {
    return { ext: fromFn, mime: mimeForAudioExt(fromFn) }
  }
  const fromCt = extFromBlobType(args.blobType)
  if (fromCt) {
    return { ext: fromCt, mime: args.blobType.trim() ? args.blobType : mimeForAudioExt(fromCt) }
  }
  return { ext: 'wav', mime: 'audio/wav' }
}

/**
 * 将 Comfy `/view?...` 等地址转为可完整播放的本地 URL：
 * 1) 已镜像到磁盘则优先 file:// 类 ObjectURL（整文件，避免流式截断）；
 * 2) 否则拉取完整字节写入 IndexedDB，再还原为 blob URL（与图片节点一致）；
 * 3) 再失败则回退原始 URL。
 */
export async function resolveComfyAudioPlaybackSrc(options: {
  comfyUrl: string
  mirrorFilePath?: string
  requestHeaders?: Record<string, string>
  fileBaseName: string
}): Promise<{ src: string; srcAssetId?: string }> {
  const comfyUrl = String(options.comfyUrl || '').trim()
  if (!comfyUrl) return { src: '' }

  const fp = String(options.mirrorFilePath || '').trim()
  if (fp) {
    const disk = await getDesktopDiskFileObjectUrl(fp)
    if (disk) return { src: disk }
  }

  const base = safeAudioFileBase(options.fileBaseName)
  const headers = options.requestHeaders && typeof options.requestHeaders === 'object' ? options.requestHeaders : {}

  const tryPersistBuffer = async (
    buf: ArrayBuffer,
    blobType: string,
    sourceUrl: string,
  ): Promise<{ src: string; srcAssetId?: string } | null> => {
    if (!buf || buf.byteLength <= 0) return null
    const { ext, mime } = resolveAudioExtAndMime({ buf, blobType, sourceUrl })
    const file = new File([buf], `${base}.${ext}`, { type: mime })
    try {
      const aid = await saveLocalImageAsset(file)
      const restored = await getLocalImageAssetObjectUrl(aid)
      if (restored) return { src: restored, srcAssetId: aid }
    } catch {
      /* fall through */
    }
    return { src: URL.createObjectURL(new Blob([buf], { type: mime })) }
  }

  let absolute = comfyUrl
  try {
    absolute = new URL(comfyUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost').toString()
  } catch {
    return { src: comfyUrl }
  }

  try {
    let res = await fetch(absolute, { mode: 'cors', credentials: 'include', headers })
    if (!res.ok) {
      res = await fetch(absolute, { mode: 'cors', credentials: 'omit', headers })
    }
    if (res.ok) {
      const buf = await res.arrayBuffer()
      const hit = await tryPersistBuffer(buf, res.headers.get('content-type') || '', absolute)
      if (hit) return hit
    }
  } catch {
    /* renderer fetch 失败（如 CORS）改走主进程 */
  }

  const desk = typeof window !== 'undefined' ? window.flowidDesktop : undefined
  if (desk?.openAiCompatFetch) {
    try {
      const r = await desk.openAiCompatFetch({
        url: absolute,
        method: 'GET',
        headers: {
          Accept: '*/*',
          Referer: typeof window !== 'undefined' ? window.location.href : '',
          Origin: typeof window !== 'undefined' ? window.location.origin : '',
          ...headers,
        },
      })
      if (r.ok && 'body' in r && r.body.byteLength > 0) {
        const ct = headerGet(r.headers, 'content-type') || 'application/octet-stream'
        const buf = r.body
        const hit = await tryPersistBuffer(buf, ct, absolute)
        if (hit) return hit
      }
    } catch {
      /* ignore */
    }
  }

  return { src: comfyUrl }
}

function headerGet(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return ''
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return String(v || '')
  }
  return ''
}
