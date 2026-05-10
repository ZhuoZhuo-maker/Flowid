import type { ProjectSnapshot } from '../types'
import {
  loadBrowserFolderHandle,
  writeBinaryToDirectoryHandle,
  writeUtf8ToDirectoryHandle,
} from './browserFolderHandleStore'
import { readLocalImageAssetBlob } from './localImageAssetStore'
import { loadLocalDiskPathsSettings } from './localDiskPathsSettings'
import { outputMirrorStemWithNodeId } from './outputMirrorStem'
import { readKvFromIndexedDb, writeKvToIndexedDb } from './historyIndexedDb'

/** 画布「自动延迟镜像」两次实际落盘之间的最短间隔（毫秒），避免拖拽等高频变更刷盘。 */
const MIRROR_INPUT_AUTO_MIN_INTERVAL_MS = 12_000

/** 单次镜像最多写入多少个文件；即使逻辑异常也卡住上限，避免占满磁盘。 */
const MIRROR_INPUT_MAX_WRITES_PER_RUN = 400

/** 上一次「自动」input 镜像结束时间戳（用于节流）。 */
let lastAutoInputMirrorDoneAt = 0

/** 自动镜像是否正在执行（与节流配合，避免并发堆积）。 */
let autoInputMirrorInFlight = false

/** input 镜像去重缓存最大条目数，防止缓存无限增长。 */
const INPUT_MIRROR_CACHE_MAX = 5000
const INPUT_MIRROR_CACHE_STORAGE_KEY = 'flowid.diskMirror.inputCache.v1'

/**
 * 记录已成功写入过的 input 镜像键：同目标目录 + 同文件名 + 同源标识命中时跳过重复写盘。
 * 这让「重复 Ctrl+S 且节点图片未变化」不会反复读取/写入同一素材。
 */
const inputMirrorWriteCache = new Map<string, number>()

async function restoreMirrorCacheFromIndexedDb(
  storageKey: string,
  max: number,
  target: Map<string, number>,
): Promise<void> {
  try {
    const rows = await readKvFromIndexedDb<Array<[string, number]>>(storageKey)
    if (!Array.isArray(rows) || rows.length < 1) return
    const start = Math.max(0, rows.length - max)
    for (let i = start; i < rows.length; i += 1) {
      const row = rows[i]
      if (!Array.isArray(row) || row.length < 1) continue
      const key = String(row[0] || '').trim()
      if (!key) continue
      const ts = Number(row[1])
      target.set(key, Number.isFinite(ts) ? ts : Date.now())
    }
  } catch {
    // ignore
  }
}

const mirrorCachePersistTimerByKey = new Map<string, number>()
function queuePersistMirrorCacheToIndexedDb(storageKey: string, cache: Map<string, number>, max: number): void {
  if (typeof window === 'undefined') return
  const prev = mirrorCachePersistTimerByKey.get(storageKey)
  if (prev) {
    window.clearTimeout(prev)
  }
  const tid = window.setTimeout(() => {
    mirrorCachePersistTimerByKey.delete(storageKey)
    const rows = Array.from(cache.entries())
    const keep = rows.slice(Math.max(0, rows.length - max))
    void writeKvToIndexedDb(storageKey, keep).catch(() => {
      // ignore
    })
  }, 120)
  mirrorCachePersistTimerByKey.set(storageKey, tid)
}

void restoreMirrorCacheFromIndexedDb(
  INPUT_MIRROR_CACHE_STORAGE_KEY,
  INPUT_MIRROR_CACHE_MAX,
  inputMirrorWriteCache,
)
try {
  window.localStorage.removeItem(INPUT_MIRROR_CACHE_STORAGE_KEY)
} catch {
  // ignore cleanup failures
}

/**
 * 标记本次镜像已写入成功，并维护一个轻量 FIFO 上限。
 */
function markInputMirrorCached(cacheKey: string): void {
  inputMirrorWriteCache.set(cacheKey, Date.now())
  if (inputMirrorWriteCache.size > INPUT_MIRROR_CACHE_MAX) {
    const overflow = inputMirrorWriteCache.size - INPUT_MIRROR_CACHE_MAX
    let dropped = 0
    for (const k of inputMirrorWriteCache.keys()) {
      inputMirrorWriteCache.delete(k)
      dropped += 1
      if (dropped >= overflow) break
    }
  }
  queuePersistMirrorCacheToIndexedDb(
    INPUT_MIRROR_CACHE_STORAGE_KEY,
    inputMirrorWriteCache,
    INPUT_MIRROR_CACHE_MAX,
  )
}

/** output 镜像去重缓存最大条目数，避免同一生成 URL 被重复落盘。 */
const OUTPUT_MIRROR_CACHE_MAX = 5000
const OUTPUT_MIRROR_CACHE_STORAGE_KEY = 'flowid.diskMirror.outputCache.v1'

/**
 * 记录已成功写入过的 output 镜像键：同目标目录 + 同源 URL 命中时跳过重复写盘。
 */
const outputMirrorWriteCache = new Map<string, number>()

void restoreMirrorCacheFromIndexedDb(
  OUTPUT_MIRROR_CACHE_STORAGE_KEY,
  OUTPUT_MIRROR_CACHE_MAX,
  outputMirrorWriteCache,
)
try {
  window.localStorage.removeItem(OUTPUT_MIRROR_CACHE_STORAGE_KEY)
} catch {
  // ignore cleanup failures
}

/**
 * 标记本次 output 镜像已写入成功，并维护一个轻量 FIFO 上限。
 */
function markOutputMirrorCached(cacheKey: string): void {
  outputMirrorWriteCache.set(cacheKey, Date.now())
  if (outputMirrorWriteCache.size > OUTPUT_MIRROR_CACHE_MAX) {
    const overflow = outputMirrorWriteCache.size - OUTPUT_MIRROR_CACHE_MAX
    let dropped = 0
    for (const k of outputMirrorWriteCache.keys()) {
      outputMirrorWriteCache.delete(k)
      dropped += 1
      if (dropped >= overflow) break
    }
  }
  queuePersistMirrorCacheToIndexedDb(
    OUTPUT_MIRROR_CACHE_STORAGE_KEY,
    outputMirrorWriteCache,
    OUTPUT_MIRROR_CACHE_MAX,
  )
}

/**
 * 触发 input 镜像的场景：`manual-save` 不受节流；`auto-canvas` 受间隔与单次写入上限约束。
 */
export type MirrorInputAssetsReason = 'manual-save' | 'auto-canvas'

/**
 * 拼接本地绝对路径下的文件名（统一使用 `/`，Windows 下 Node 可接受）。
 */
function joinPath(baseDir: string, fileName: string): string {
  const b = String(baseDir || '').trim().replace(/[\\/]+$/, '')
  return `${b}/${fileName}`.replace(/\\/g, '/')
}

/**
 * 将展示名整理为安全文件名片段。
 * 导出供历史面板等与落盘文件名规则对齐的去重逻辑使用。
 */
export function sanitizeFileStem(raw: string): string {
  const base = String(raw || '').trim() || 'flowid'
  return base
    // eslint-disable-next-line no-control-regex -- 与工程文件名规则一致，剔除非法字符
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'flowid'
}

/**
 * 在同一轮镜像中按文件名占用集合做递增：`名称` / `名称2` / `名称3` …
 * 仅用于避免同批次不同节点写到相同文件名。
 */
function allocateMirrorFileStemInRun(occupied: Set<string>, preferredStem: string): string {
  const clean = sanitizeFileStem(preferredStem) || 'flowid'
  const lc = clean.toLowerCase()
  if (!occupied.has(lc)) {
    occupied.add(lc)
    return clean
  }
  const m = clean.match(/^(.*?)(\d+)$/)
  const head = (m ? m[1] : clean).trim() || clean
  let n = m ? Number.parseInt(m[2], 10) + 1 : 2
  for (;;) {
    const candidate = `${head}${n}`
    const key = candidate.toLowerCase()
    if (!occupied.has(key)) {
      occupied.add(key)
      return candidate
    }
    n += 1
  }
}

/**
 * 工作流落盘用主文件名：安全化后若用户已写 `.json` 后缀则去掉，避免写成 `xxx.json.json`。
 */
function workflowStemForFilename(raw: string): string {
  let stem = sanitizeFileStem(raw)
  if (/\.json$/i.test(stem)) {
    stem = stem.slice(0, -5).trim() || 'flowid'
  }
  return stem
}

/**
 * 是否具备桌面端二进制写入能力。
 */
function hasDesktopBinaryWrite(): boolean {
  return Boolean(typeof window !== 'undefined' && window.flowidDesktop?.writeBinaryFile)
}

/**
 * 是否具备桌面端 UTF-8 写入能力。
 */
function hasDesktopUtf8Write(): boolean {
  return Boolean(typeof window !== 'undefined' && window.flowidDesktop?.writeUtf8File)
}

/**
 * 根据 MIME 推断扩展名（生成物落盘用）。
 */
function extFromMime(ct: string, mediaKind: 'image' | 'video' | 'audio'): string {
  const c = String(ct || '').toLowerCase()
  if (mediaKind === 'image') {
    if (c.includes('png')) return 'png'
    if (c.includes('jpeg') || c.includes('jpg')) return 'jpg'
    if (c.includes('webp')) return 'webp'
    if (c.includes('gif')) return 'gif'
    return 'png'
  }
  if (mediaKind === 'video') {
    if (c.includes('webm')) return 'webm'
    if (c.includes('mp4')) return 'mp4'
    return 'mp4'
  }
  if (c.includes('wav')) return 'wav'
  if (c.includes('mpeg') || c.includes('mp3')) return 'mp3'
  if (c.includes('ogg')) return 'ogg'
  if (c.includes('flac')) return 'flac'
  if (c.includes('mp4') || c.includes('m4a')) return 'm4a'
  if (c.includes('aac')) return 'aac'
  if (c.includes('opus')) return 'opus'
  if (c.includes('webm')) return 'webm'
  return 'bin'
}

/**
 * 用户一旦保存工作流（含导入后落库、可视化编辑器保存），即将当前 JSON 原文写入「工作流」目录。
 * 桌面端：写绝对路径；Chrome / Edge：写用户在设置里为「工作流」绑定的目录句柄（与手填路径无关）。
 * 不做内容格式校验；文件名仅做安全化处理。
 *
 * @param workflowName 用户保存时使用的工作流名称（列表里显示的名字）
 * @param jsonText 工作流 JSON 文本
 */
export async function persistWorkflowJsonToDisk(workflowName: string, jsonText: string): Promise<void> {
  const text = String(jsonText || '').trim()
  if (!text) return
  const stem = workflowStemForFilename(workflowName)
  const fileName = `${stem}.json`
  const electronDir = hasDesktopUtf8Write() ? loadLocalDiskPathsSettings().workflowPath.trim() : ''
  if (electronDir && window.flowidDesktop?.writeUtf8File) {
    const fp = joinPath(electronDir, fileName)
    const res = await window.flowidDesktop.writeUtf8File(fp, text)
    if (!res.ok) {
      console.warn('[Flowid] 写入工作流目录失败', res.error, fp)
    }
    return
  }
  const browserDir = await loadBrowserFolderHandle('workflowPath')
  if (!browserDir) return
  const wr = await writeUtf8ToDirectoryHandle(browserDir, fileName, text)
  if (!wr.ok) {
    console.warn('[Flowid] 浏览器写入工作流目录失败', wr.error, fileName)
  }
}

/**
 * 将用户上传的参考图/素材复制一份到「输入」目录。
 * 桌面端：写 `inputPath` 绝对路径；浏览器：写设置里为「输入」绑定的目录句柄（须点「选择文件夹」授权到真实磁盘目录，如与 Comfy 相同的 input）。
 *
 * @param file 原始文件对象
 * @param assetId 若传入（IndexedDB 资产 id），则使用稳定文件名 `flowid-asset-{id}.{ext}` 便于覆盖去重；不传则按时间戳生成新文件。
 */
export async function mirrorUploadToInputDir(file: File, assetId?: string): Promise<void> {
  const rawName = String(file.name || 'upload').trim() || 'upload'
  const dot = rawName.lastIndexOf('.')
  const baseStem = dot > 0 ? rawName.slice(0, dot) : rawName
  const extFromName = dot > 0 ? rawName.slice(dot) : ''
  const extFromMime = (): string => {
    const t = String(file.type || '').toLowerCase()
    if (t.includes('png')) return '.png'
    if (t.includes('jpeg') || t.includes('jpg')) return '.jpg'
    if (t.includes('webp')) return '.webp'
    if (t.includes('gif')) return '.gif'
    if (t.includes('wav')) return '.wav'
    if (t.includes('mpeg') || t.includes('mp3')) return '.mp3'
    if (t.includes('flac')) return '.flac'
    if (t.includes('ogg')) return '.ogg'
    if (t.includes('mp4') || t.includes('m4a')) return '.m4a'
    if (t.includes('aac')) return '.aac'
    if (t.includes('opus')) return '.opus'
    if (t.includes('webm')) return '.webm'
    if (t.includes('quicktime') || t.includes('mov')) return '.mov'
    return extFromName || '.bin'
  }
  const stem = sanitizeFileStem(baseStem)
  const aid = String(assetId || '').trim()
  const fileName = aid
    ? `flowid-asset-${aid}${extFromName || extFromMime()}`
    : `${stem}-${Date.now().toString(36)}${extFromName || extFromMime()}`
  try {
    const buf = await file.arrayBuffer()
    const electronDir = hasDesktopBinaryWrite() ? loadLocalDiskPathsSettings().inputPath.trim() : ''
    const desk = window.flowidDesktop
    if (electronDir && desk?.writeBinaryFile) {
      const fp = joinPath(electronDir, fileName)
      const res = await desk.writeBinaryFile(fp, buf)
      if (!res.ok) {
        console.warn('[Flowid] 写入输入目录失败', res.error, fp)
      } else {
        console.info('[Flowid] 已写入 input', fp)
      }
      return
    }
    const browserDir = await loadBrowserFolderHandle('inputPath')
    if (!browserDir) return
    const br = await writeBinaryToDirectoryHandle(browserDir, fileName, buf)
    if (!br.ok) {
      console.warn('[Flowid] 浏览器写入 input 失败', br.error, fileName)
    } else {
      console.info('[Flowid] 已写入 input（浏览器句柄）', fileName)
    }
  } catch (e) {
    console.warn('[Flowid] 镜像上传图到输入目录异常', e)
  }
}

export type MirrorComfyOutputKind = 'image' | 'video' | 'music' | 'audio'

function headerGet(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return ''
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return String(v || '')
  }
  return ''
}

/**
 * 拉取生成物字节：先走渲染进程 fetch（同源/已放行 CORS）；失败时在桌面端用主进程 fetch（绕过 CORS），与 OpenAI 直连 IPC 共用实现。
 */
async function fetchMediaBytesForMirror(
  mediaUrl: string,
  requestHeaders?: Record<string, string>,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const raw = String(mediaUrl || '').trim()
  if (!raw) return null
  let url = raw
  try {
    // 兼容相对路径（如 `/view?...`、`/gradio_api/file=...`），统一补全为绝对 URL 后再抓取。
    url = new URL(raw, window.location.href).toString()
  } catch {
    return null
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null
  const extraHeaders = requestHeaders && typeof requestHeaders === 'object' ? requestHeaders : {}
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'include', headers: extraHeaders })
    if (res.ok) {
      const buffer = await res.arrayBuffer()
      return { buffer, contentType: res.headers.get('content-type') || '' }
    }
  } catch {
    // 常见：跨域图片 URL 在浏览器里 fetch 被 CORS 拦截，改走主进程。
  }
  try {
    // 二次兜底：部分地址不接受携带凭据，退回 omit 再尝试一次。
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', headers: extraHeaders })
    if (res.ok) {
      const buffer = await res.arrayBuffer()
      return { buffer, contentType: res.headers.get('content-type') || '' }
    }
  } catch {
    // ignore
  }
  const desk = window.flowidDesktop
  if (!desk?.openAiCompatFetch) return null
  try {
    const r = await desk.openAiCompatFetch({
      url,
      method: 'GET',
      headers: {
        Accept: '*/*',
        Referer: window.location.href,
        Origin: window.location.origin,
        ...extraHeaders,
      },
    })
    if (!r.ok || !r.body) return null
    const ct = headerGet(r.headers, 'content-type')
    return { buffer: r.body, contentType: ct }
  } catch {
    return null
  }
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const s = String(dataUrl || '').trim()
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(s)
  if (!m) return null
  return { mime: m[1] || 'application/octet-stream', base64: m[2] || '' }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(String(b64 || '').trim())
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/**
 * 将 Comfy 返回的可拉取 URL 对应媒体落盘到「输出」目录（桌面绝对路径或浏览器已绑定 output 句柄）。
 * 跨域拉取失败时静默跳过，不影响画布展示。
 *
 * @param args.url 媒体地址（通常为 http(s) 或同源代理路径）
 * @param args.mediaKind 媒体大类，用于扩展名回退
 * @param args.title 可选，写入文件名前缀
 */
export async function mirrorComfyOutputToDisk(args: {
  url: string
  mediaKind: MirrorComfyOutputKind
  title?: string
  /** 画布节点 id（无连字符片段写入文件名），避免跨工程/同标题串文件 */
  nodeId: string
  requestHeaders?: Record<string, string>
}): Promise<{ saved: boolean; reason?: string; fileName?: string; filePath?: string }> {
  const electronOut = hasDesktopBinaryWrite() ? loadLocalDiskPathsSettings().outputPath.trim() : ''
  const browserOut = await loadBrowserFolderHandle('outputPath')
  if (!electronOut && !browserOut) return { saved: false, reason: 'output-path-not-configured' }
  const targetScope = electronOut
    ? `electron:${electronOut}`
    : `browser:${browserOut?.name || 'bound-output'}`
  const rawUrl = String(args.url || '').trim()
  if (!rawUrl) return { saved: false, reason: 'empty-url' }
  if (rawUrl.startsWith('blob:')) return { saved: false, reason: 'unsupported-url' }
  let url = rawUrl
  try {
    // data: URL 不参与 URL 归一化
    if (!rawUrl.startsWith('data:')) {
      url = new URL(rawUrl, window.location.href).toString()
    }
  } catch {
    return { saved: false, reason: 'bad-url' }
  }
  const mediaKind: 'image' | 'video' | 'audio' =
    args.mediaKind === 'video' ? 'video' : args.mediaKind === 'image' ? 'image' : 'audio'
  const outputCacheKey = `${targetScope}|${mediaKind}|${url}`
  if (outputMirrorWriteCache.has(outputCacheKey)) return { saved: true, reason: 'cache-hit' }
  try {
    let buf: ArrayBuffer
    let ct = ''
    if (url.startsWith('data:')) {
      const parsed = parseDataUrl(url)
      if (!parsed?.base64) return { saved: false, reason: 'bad-data-url' }
      ct = parsed.mime
      buf = base64ToArrayBuffer(parsed.base64)
    } else {
      const got = await fetchMediaBytesForMirror(url, args.requestHeaders)
      if (!got) {
        console.warn('[Flowid] 拉取生成物失败，跳过输出目录镜像', url)
        return { saved: false, reason: 'fetch-media-failed' }
      }
      ct = got.contentType
      buf = got.buffer
    }
    const ext =
      mediaKind === 'image'
        ? extFromMime(ct, 'image')
        : mediaKind === 'video'
          ? extFromMime(ct, 'video')
          : extFromMime(ct, 'audio')
    const stem = outputMirrorStemWithNodeId(args.title, args.nodeId)
    /**
     * 输出镜像按「标题 + 节点 id + 时间戳」命名：
     * - 避免同节点重复执行时覆盖旧文件；
     * - 节点 id 段避免跨工程、仅标题相同导致的误匹配。
     */
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${stem}-${stamp}.${ext}`
    const desk = window.flowidDesktop
    if (electronOut && desk?.writeBinaryFile) {
      const fp = joinPath(electronOut, fileName)
      const wr = await desk.writeBinaryFile(fp, buf)
      if (!wr.ok) {
        console.warn('[Flowid] 写入输出目录失败', wr.error, fp)
        return { saved: false, reason: 'desktop-write-failed' }
      } else {
        markOutputMirrorCached(outputCacheKey)
        return { saved: true, fileName, filePath: fp }
      }
    }
    if (browserOut) {
      const wr = await writeBinaryToDirectoryHandle(browserOut, fileName, buf)
      if (!wr.ok) {
        console.warn('[Flowid] 浏览器写入 output 失败', wr.error, fileName)
        return { saved: false, reason: 'browser-write-failed' }
      } else {
        markOutputMirrorCached(outputCacheKey)
        return { saved: true, fileName }
      }
    }
    return { saved: false, reason: 'no-writer-available' }
  } catch (e) {
    console.warn('[Flowid] 镜像生成物到输出目录异常', e)
    return { saved: false, reason: 'mirror-exception' }
  }
}

/**
 * 根据「工程快照」把画布上的本地图资产与仍有效的 `blob:` 主资源写入「输入」目录。
 * 桌面端写绝对路径；浏览器写设置里绑定的 input 目录句柄。
 * 文件名优先按「节点标题」落盘，便于与画布一一对应；同源未变化时命中缓存直接跳过，不重复写盘。
 * 安全机制：`reason: 'auto-canvas'` 时限制两次落盘最短间隔、禁止并发、单次最多写入 {@link MIRROR_INPUT_MAX_WRITES_PER_RUN} 个文件；显式保存不受间隔限制。
 *
 * @param snapshot 当前序列化工程快照
 * @param options.reason 默认 `manual-save`（与 Ctrl+S 等保存路径一致）
 */
export async function mirrorInputAssetsFromProjectSnapshot(
  snapshot: ProjectSnapshot,
  options?: { reason?: MirrorInputAssetsReason },
): Promise<void> {
  const reason = options?.reason ?? 'manual-save'
  const isAuto = reason === 'auto-canvas'

  if (isAuto) {
    const t = Date.now()
    if (t - lastAutoInputMirrorDoneAt < MIRROR_INPUT_AUTO_MIN_INTERVAL_MS) return
    if (autoInputMirrorInFlight) return
    autoInputMirrorInFlight = true
  }

  try {
    if (!Array.isArray(snapshot.nodes)) return
    const electronDir = hasDesktopBinaryWrite() ? loadLocalDiskPathsSettings().inputPath.trim() : ''
    const browserInputDir = await loadBrowserFolderHandle('inputPath')
    if (!electronDir && !browserInputDir) return
    const targetScope = electronDir
      ? `electron:${electronDir}`
      : `browser:${browserInputDir?.name || 'bound-input'}`

    const desk = window.flowidDesktop
    const writeBinaryFile = desk?.writeBinaryFile

    let wrote = 0
    let writeBudget = MIRROR_INPUT_MAX_WRITES_PER_RUN
    let budgetWarned = false
    const writeBytes = async (buf: ArrayBuffer, relativeName: string, sourceKey: string) => {
      if (writeBudget <= 0) {
        if (!budgetWarned) {
          budgetWarned = true
          console.warn(
            '[Flowid] 单次 input 镜像已达写入上限',
            MIRROR_INPUT_MAX_WRITES_PER_RUN,
            '，已停止后续写入以免占满磁盘。可保存工程后检查画布节点数量。',
          )
        }
        return
      }
      const nameOnly = relativeName.replace(/^.*[/\\]/, '') || relativeName
      const cacheKey = `${targetScope}|${nameOnly}|${sourceKey}`
      if (inputMirrorWriteCache.has(cacheKey)) return
      if (electronDir && writeBinaryFile) {
        const fp = joinPath(electronDir, nameOnly)
        const res = await writeBinaryFile(fp, buf)
        if (!res.ok) {
          console.warn('[Flowid] 写入 input 目录失败', res.error, fp)
        } else {
          wrote += 1
          writeBudget -= 1
          markInputMirrorCached(cacheKey)
        }
        return
      }
      if (browserInputDir) {
        const br = await writeBinaryToDirectoryHandle(browserInputDir, nameOnly, buf)
        if (!br.ok) {
          console.warn('[Flowid] 浏览器写入 input 失败', br.error, nameOnly)
        } else {
          wrote += 1
          writeBudget -= 1
          markInputMirrorCached(cacheKey)
        }
      }
    }

    const mediaFromKind = (k: string): 'image' | 'video' | 'audio' => {
      if (k === 'video') return 'video'
      if (k === 'audio' || k === 'music') return 'audio'
      return 'image'
    }

    const seenAssetId = new Set<string>()
    const seenBlobKey = new Set<string>()
    const occupiedFileStem = new Set<string>()

    for (const node of snapshot.nodes) {
      const d = node.data as Record<string, unknown> | undefined
      if (!d || typeof d !== 'object') continue
      const kind = String(d.kind || '')

      const nodeTitleStem = allocateMirrorFileStemInRun(
        occupiedFileStem,
        String(d.title || `${kind || '节点'}节点`),
      )

      /**
       * 将节点主 `blob:` 按节点名写入 input，多次保存在源不变时直接命中缓存跳过，不重复写盘。
       */
      const writeBlobPrimaryToDisk = async (blob: Blob, media: 'image' | 'video' | 'audio') => {
        const ext = extFromMime(blob.type, media)
        const fn = `${nodeTitleStem}.${ext}`
        await writeBytes(await blob.arrayBuffer(), fn, `blob:${node.id}:${kind}:${String(d.src || '').trim()}`)
      }

      const sid = String(d.srcAssetId || '').trim()
      if (sid && !seenAssetId.has(sid)) {
        seenAssetId.add(sid)
        const blob = await readLocalImageAssetBlob(sid)
        if (blob?.size) {
          const ext = extFromMime(blob.type, mediaFromKind(kind))
          await writeBytes(await blob.arrayBuffer(), `${nodeTitleStem}.${ext}`, `asset:${sid}`)
        }
      }

      const refIds = d.referenceImageAssetIds
      if (Array.isArray(refIds)) {
        for (let i = 0; i < refIds.length; i += 1) {
          const rid = String(refIds[i] || '').trim()
          if (!rid || seenAssetId.has(rid)) continue
          seenAssetId.add(rid)
          const blob = await readLocalImageAssetBlob(rid)
          if (blob?.size) {
            const ext = extFromMime(blob.type, 'image')
            const refStem = allocateMirrorFileStemInRun(occupiedFileStem, `${nodeTitleStem}-参考${i + 1}`)
            await writeBytes(await blob.arrayBuffer(), `${refStem}.${ext}`, `asset:${rid}`)
          }
        }
      }

      const src = String(d.src || '').trim()
      const blobPrimaryKinds =
        kind === 'image' ||
        kind === 'video' ||
        kind === 'panorama' ||
        kind === 'audio' ||
        kind === 'music'
      if (src.startsWith('blob:') && blobPrimaryKinds) {
        const bkey = `blob:${node.id}:src`
        if (seenBlobKey.has(bkey)) continue
        try {
          const res = await fetch(src)
          const blob = await res.blob()
          if (!blob.size) continue
          seenBlobKey.add(bkey)
          await writeBlobPrimaryToDisk(blob, mediaFromKind(kind))
        } catch {
          /* blob: 已失效或非同源时 fetch 失败，跳过 */
        }
      }
    }

    if (wrote > 0) {
      console.info('[Flowid] 画布→input 镜像完成', {
        写入条数: wrote,
        目标: electronDir || '浏览器已绑定 input 句柄',
        触发: reason,
      })
    }
  } finally {
    if (isAuto) {
      autoInputMirrorInFlight = false
      lastAutoInputMirrorDoneAt = Date.now()
    }
  }
}
