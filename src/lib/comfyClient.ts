import type { NodeRunProgress, WorkflowProviderConfig } from '../types'
import { encodeComfyDevProxyBaseSegment } from './comfyDevProxyCodec'

type SubmitPromptResponse = {
  prompt_id?: string
}

type ComfyImageRef = {
  filename?: string
  /** 部分网关/节点用 `name` 代替 `filename` */
  name?: string
  subfolder?: string
  type?: string
}

type ComfyAudioRef = {
  filename: string
  subfolder?: string
  type?: string
}

type ComfyMediaRef = {
  filename: string
  subfolder?: string
  type?: string
}

/**
 * 将类似 "output/foo/bar.png"、"temp/xxx.png" 的路径解析为 view 所需字段。
 */
function parseComfyPathLikeRef(raw: string): {
  filename: string
  subfolder?: string
  type?: string
} | null {
  const normalized = raw.replace(/\\/g, '/').trim()
  if (!normalized) return null
  /** Wan/VHS 控制台常打印绝对路径：`/root/ComfyUI/output/Video/2026-05-10/foo.mp4` */
  const outputTail = /\/(?:comfyui\/)?output\/(.+)$/i.exec(normalized)
  if (outputTail?.[1]) {
    const parts = outputTail[1].split('/').filter(Boolean)
    const filename = parts[parts.length - 1]
    if (!filename) return null
    const subfolder = parts.length > 1 ? parts.slice(0, -1).join('/') : undefined
    return { filename, subfolder, type: 'output' }
  }
  const parts = normalized.split('/').filter(Boolean)
  const filename = parts[parts.length - 1]
  if (!filename) return null
  let type: string | undefined
  let startIdx = 0
  const first = (parts[0] || '').toLowerCase()
  if (first === 'output' || first === 'temp' || first === 'input') {
    type = first
    startIdx = 1
  }
  const subfolderParts = parts.slice(startIdx, -1)
  const subfolder = subfolderParts.length ? subfolderParts.join('/') : undefined
  return { filename, subfolder, type }
}

const AUDIO_FILE_EXTENSIONS = new Set([
  '.wav',
  '.mp3',
  '.flac',
  '.m4a',
  '.ogg',
  '.aac',
  '.opus',
])

const MEDIA_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
  '.mp4',
  '.mov',
  '.webm',
  '.avi',
  '.mkv',
])

/**
 * ComfyUI 连接检测结果。
 */
export type ComfyHealthResult = {
  ok: boolean
  message: string
}

function sanitizeFilenamePart(raw: string): string {
  return raw.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, '_').slice(0, 48) || 'input'
}

/**
 * 生成上传文件名随机后缀，避免同毫秒多图上传时文件名碰撞被覆盖。
 */
function buildUploadRandomSuffix(): string {
  try {
    const arr = new Uint32Array(1)
    crypto.getRandomValues(arr)
    return arr[0].toString(36).slice(0, 6)
  } catch {
    return Math.floor(Math.random() * 0xfffff).toString(36)
  }
}

/**
 * 带超时的 fetch，避免网络层长时间挂起导致“无反馈”。
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
  try {
    return await fetch(input, { ...(init ?? {}), signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 同页 `blob:` / `data:` 读取：不用带 Abort 的超时 fetch，避免误报 network_error；
 * 且部分环境下超时 abort 与 blob 组合会失败（执行前若 blob 已回收仍会失败，需上游刷新 URL）。
 */
async function readBlobOrDataUrlAsBlob(url: string): Promise<Blob | null> {
  const raw = String(url || '').trim()
  if (!raw.startsWith('blob:') && !raw.startsWith('data:')) return null
  try {
    const res = await fetch(raw)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

/**
 * 生成“可读取源图”的候选地址。
 * 兼容 `/view?...`、`view?...` 与完整 URL，减少历史数据/旧链接导致的 404。
 */
function buildImageReadCandidates(imageUrl: string, requestBase: string): string[] {
  const raw = imageUrl.trim()
  if (!raw) return []
  const list = new Set<string>([raw])
  const normalizedBase = requestBase.replace(/\/+$/, '')
  const withoutLeadingSlash = raw.replace(/^\/+/, '')
  const normalizedRawPath = raw.replace(/\/+$/, '')
  const alreadyContainsRequestBase =
    Boolean(normalizedBase) &&
    (normalizedRawPath === normalizedBase ||
      normalizedRawPath.startsWith(`${normalizedBase}/`))
  // 兼容历史脏数据：可能已写入重复代理前缀（如 /__comfy_local__/__comfy_local__/view?...）。
  if (normalizedBase) {
    const duplicatedPrefix = `${normalizedBase}${normalizedBase}/`
    const duplicatedPrefixNoSlash = `${normalizedBase}${normalizedBase}`
    if (raw.startsWith(duplicatedPrefix)) {
      list.add(`${normalizedBase}/${raw.slice(duplicatedPrefix.length)}`)
    } else if (raw.startsWith(duplicatedPrefixNoSlash)) {
      list.add(`${normalizedBase}/${raw.slice(duplicatedPrefixNoSlash.length).replace(/^\/+/, '')}`)
    }
    if (raw.startsWith(`${normalizedBase}/${withoutLeadingSlash}`)) {
      list.add(`${normalizedBase}/${withoutLeadingSlash.replace(/^__comfy_local__\/+/i, '')}`)
    }
  }
  if (raw.startsWith('/view?')) {
    list.add(`${normalizedBase}${raw}`)
  }
  if (raw.startsWith('view?')) {
    list.add(`${normalizedBase}/${raw}`)
  }
  if (
    !/^https?:\/\//i.test(raw) &&
    !raw.startsWith('blob:') &&
    !raw.startsWith('data:') &&
    !alreadyContainsRequestBase
  ) {
    list.add(`${normalizedBase}/${withoutLeadingSlash}`)
  }

  // 针对 Comfy view 查询参数做容错：清洗 filename，并尝试 type 变体。
  const toAbsoluteLike = (candidate: string) => {
    if (/^https?:\/\//i.test(candidate)) return candidate
    if (candidate.startsWith('/')) return `${window.location.origin}${candidate}`
    return `${window.location.origin}/${candidate}`
  }
  const viewCandidates = Array.from(list).filter((candidate) => candidate.includes('/view?') || candidate.includes('view?'))
  for (const candidate of viewCandidates) {
    try {
      const url = new URL(toAbsoluteLike(candidate))
      if (!url.pathname.endsWith('/view') && url.pathname !== '/view') continue
      const filename = (url.searchParams.get('filename') || '').trim()
      if (!filename) continue
      const cleanedFilename = filename.replace(/\s+\./g, '.').replace(/\s+/g, ' ').trim()
      const filenameVariants = Array.from(
        new Set([
          filename,
          cleanedFilename,
          cleanedFilename.replace(/\s+/g, '_'),
          cleanedFilename.replace(/\s+/g, '_').replace(/\./, '_.'),
          cleanedFilename.replace(/_/g, ' '),
        ].map((v) => v.trim()).filter(Boolean)),
      )
      const subfolder = (url.searchParams.get('subfolder') || '').trim()
      const typeCandidates = ['input', 'output', 'temp']
      for (const nameVariant of filenameVariants) {
        const basePath = `${url.pathname}?filename=${encodeURIComponent(nameVariant)}`
        for (const t of typeCandidates) {
          const withType = `${basePath}${subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : ''}&type=${t}`
          if (candidate.startsWith('http')) {
            list.add(`${url.origin}${withType}`)
          } else if (candidate.startsWith('/')) {
            list.add(withType)
          } else {
            list.add(withType.replace(/^\//, ''))
          }
        }
      }
    } catch {
      // 非标准 URL，忽略该候选。
    }
  }
  return Array.from(list)
}

/**
 * 判断图片读取地址是否为 Comfy 资源地址。
 * 仅当命中 Comfy 地址时附带鉴权头，避免对外部 URL 造成无意义预检。
 */
function isComfyImageUrl(candidateUrl: string, baseUrl: string, requestBase: string): boolean {
  const c = candidateUrl.trim()
  if (!c) return false
  if (c.startsWith('/__comfy_local__/')) return true
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const normalizedRequestBase = requestBase.replace(/\/+$/, '')
  if (normalizedBase && c.startsWith(normalizedBase)) return true
  if (normalizedRequestBase && c.startsWith(normalizedRequestBase)) return true
  return false
}

async function blobToPngBlob(source: Blob): Promise<Blob> {
  if (source.type === 'image/png') return source
  const bitmap = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建 Canvas 上下文，无法转换为 PNG')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pngBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
  if (!pngBlob) {
    throw new Error('图片转 PNG 失败')
  }
  return pngBlob
}

/**
 * Comfy `/upload/image` 返回结构归一化后，用于写入 `LoadImage` 的 `[filename, subfolder, type]`。
 */
export type ComfyUploadedInputImage = {
  filename: string
  subfolder: string
  type: string
}

/**
 * 将图片 URL 上传到 Comfy input 目录（统一转为 png），返回可注入工作流的文件名与目录信息。
 */
export async function uploadComfyInputImageAsPng({
  providerConfig,
  imageUrl,
  filenamePrefix,
}: {
  providerConfig: WorkflowProviderConfig
  imageUrl: string
  filenamePrefix?: string
}): Promise<ComfyUploadedInputImage> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const ioTimeoutMs = Math.max(8, providerConfig.timeoutSec || 30) * 1000
  let originalBlob: Blob | null = await readBlobOrDataUrlAsBlob(imageUrl)
  if (!originalBlob) {
  const candidates = buildImageReadCandidates(imageUrl, requestBase)
  let imageResponse: Response | null = null
  let lastStatusText = ''
  const tried: string[] = []
  for (const candidate of candidates) {
    const headers = isComfyImageUrl(candidate, baseUrl, requestBase)
      ? getAuthHeaders(providerConfig)
      : undefined
    const resp = await fetchWithTimeout(
      candidate,
      headers ? { headers } : undefined,
      ioTimeoutMs,
    ).catch(() => null)
    if (!resp) {
      tried.push(`${candidate} -> network_error`)
      continue
    }
    if (resp.ok) {
      imageResponse = resp
      break
    }
    tried.push(`${candidate} -> ${resp.status}`)
    lastStatusText = `${resp.status}`
  }
  if (!imageResponse) {
    const reason = lastStatusText || '网络异常'
    const triedPreview = tried.slice(0, 8).join(' | ')
    throw new Error(`读取图片失败（${reason}）。候选: ${triedPreview || '（无）'}`)
  }
  originalBlob = await imageResponse.blob()
  }
  const pngBlob = await blobToPngBlob(originalBlob)
  const safePrefix = sanitizeFilenamePart(filenamePrefix || 'flowid')
  const fileName = `${safePrefix}_${Date.now()}_${buildUploadRandomSuffix()}.png`
  const authHeaders = getAuthHeaders(providerConfig)
  /** 每次请求新建 FormData，避免 Body 已被读取导致重试失败。 */
  const uploadOnce = async (path: string) => {
    const form = new FormData()
    form.append('image', new File([pngBlob], fileName, { type: 'image/png' }))
    form.append('type', 'input')
    form.append('overwrite', 'true')
    return fetchWithTimeout(
      `${requestBase}${path}`,
      {
        method: 'POST',
        headers: authHeaders,
        body: form,
      },
      ioTimeoutMs,
    )
  }
  let response = await uploadOnce('/upload/image')
  if (response.status === 404) {
    response = await uploadOnce('/api/upload/image')
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(`上传参考图到 Comfy 失败（${response.status}）${bodyText ? `：${bodyText}` : ''}`)
  }
  const payload = (await response.json()) as Record<string, unknown>
  const uploadedName =
    (typeof payload.name === 'string' && payload.name) ||
    (typeof payload.filename === 'string' && payload.filename) ||
    fileName
  const subfolder = typeof payload.subfolder === 'string' ? payload.subfolder : ''
  const imageType = typeof payload.type === 'string' ? payload.type : 'input'
  return {
    filename: uploadedName,
    subfolder,
    type: imageType,
  }
}

function guessBinaryUploadExtension(mediaUrl: string, blob: Blob): string {
  const t = String(blob.type || '').toLowerCase()
  if (t.startsWith('video/')) {
    if (t.includes('webm')) return '.webm'
    if (t.includes('quicktime') || t.includes('mov')) return '.mov'
    return '.mp4'
  }
  if (t.includes('wav')) return '.wav'
  if (t.includes('mpeg') || t.includes('mp3')) return '.mp3'
  if (t.includes('m4a') || (t.includes('mp4') && t.startsWith('audio/'))) return '.m4a'
  if (t.includes('flac')) return '.flac'
  if (t.includes('ogg')) return '.ogg'
  if (t.includes('aac')) return '.aac'
  if (t.includes('opus')) return '.opus'
  const pathLower = mediaUrl.split('?')[0].toLowerCase()
  for (const ext of MEDIA_FILE_EXTENSIONS) {
    if (pathLower.endsWith(ext)) return ext
  }
  for (const ext of AUDIO_FILE_EXTENSIONS) {
    if (pathLower.endsWith(ext)) return ext
  }
  return '.mp3'
}

/**
 * 将音频/二进制 URL 原样上传到 Comfy `input`（走 `/upload/image` 表单字段名 `image`，服务端按字节落盘）。
 * 供 `LoadAudio` 等节点通过文件名引用。
 */
export async function uploadComfyInputBinaryFile({
  providerConfig,
  mediaUrl,
  filenamePrefix,
  preferredExtension,
}: {
  providerConfig: WorkflowProviderConfig
  mediaUrl: string
  filenamePrefix?: string
  preferredExtension?: string
}): Promise<ComfyUploadedInputImage> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const ioTimeoutMs = Math.max(8, providerConfig.timeoutSec || 30) * 1000
  let originalBlob: Blob | null = await readBlobOrDataUrlAsBlob(mediaUrl)
  if (!originalBlob) {
  const candidates = buildImageReadCandidates(mediaUrl, requestBase)
  let mediaResponse: Response | null = null
  let lastStatusText = ''
  const tried: string[] = []
  for (const candidate of candidates) {
    const headers = isComfyImageUrl(candidate, baseUrl, requestBase)
      ? getAuthHeaders(providerConfig)
      : undefined
    const resp = await fetchWithTimeout(
      candidate,
      headers ? { headers } : undefined,
      ioTimeoutMs,
    ).catch(() => null)
    if (!resp) {
      tried.push(`${candidate} -> network_error`)
      continue
    }
    if (resp.ok) {
      mediaResponse = resp
      break
    }
    tried.push(`${candidate} -> ${resp.status}`)
    lastStatusText = `${resp.status}`
  }
  if (!mediaResponse) {
    const reason = lastStatusText || '网络异常'
    const triedPreview = tried.slice(0, 8).join(' | ')
    throw new Error(`读取音频失败（${reason}）。候选: ${triedPreview || '（无）'}`)
  }
  originalBlob = await mediaResponse.blob()
  }
  const extRaw = preferredExtension || guessBinaryUploadExtension(mediaUrl, originalBlob)
  const ext = extRaw.startsWith('.') ? extRaw : `.${extRaw}`
  const safePrefix = sanitizeFilenamePart(filenamePrefix || 'flowid_audio')
  const fileName = `${safePrefix}_${Date.now()}_${buildUploadRandomSuffix()}${ext}`
  const authHeaders = getAuthHeaders(providerConfig)
  const uploadOnce = async (path: string) => {
    const form = new FormData()
    form.append(
      'image',
      new File([originalBlob], fileName, {
        type: originalBlob.type || 'application/octet-stream',
      }),
    )
    form.append('type', 'input')
    form.append('overwrite', 'true')
    return fetchWithTimeout(
      `${requestBase}${path}`,
      {
        method: 'POST',
        headers: authHeaders,
        body: form,
      },
      ioTimeoutMs,
    )
  }
  let response = await uploadOnce('/upload/image')
  if (response.status === 404) {
    response = await uploadOnce('/api/upload/image')
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(`上传音频到 Comfy 失败（${response.status}）${bodyText ? `：${bodyText}` : ''}`)
  }
  const payload = (await response.json()) as Record<string, unknown>
  const uploadedName =
    (typeof payload.name === 'string' && payload.name) ||
    (typeof payload.filename === 'string' && payload.filename) ||
    fileName
  const subfolder = typeof payload.subfolder === 'string' ? payload.subfolder : ''
  const imageType = typeof payload.type === 'string' ? payload.type : 'input'
  return {
    filename: uploadedName,
    subfolder,
    type: imageType,
  }
}

/**
 * 尝试访问媒体 URL，过滤 404/鉴权失败等无效链接，避免节点写入破图地址。
 * @param timeoutMs 超时（默认 10s），避免 Comfy 无响应时节点长期卡在「执行中」。
 */
export async function verifyComfyMediaUrl({
  providerConfig,
  mediaUrl,
  timeoutMs = 10_000,
}: {
  providerConfig: WorkflowProviderConfig
  mediaUrl: string | null | undefined
  /** 校验请求超时毫秒数 */
  timeoutMs?: number
}): Promise<string | null> {
  if (!mediaUrl) return null
  const url = String(mediaUrl).trim()
  const auth = getAuthHeaders(providerConfig)
  const t = Math.max(2000, timeoutMs)
  const okResponse = (res: Response) => res.ok || res.status === 206
  try {
    // Comfy `/view` 整文件 GET 在云端长音频上易超时；优先 Range 探测，失败再整包 GET。
    if (/\/view\?/i.test(url)) {
      const rangeRes = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: { ...auth, Range: 'bytes=0-8191' },
        },
        t,
      )
      if (okResponse(rangeRes)) return mediaUrl
    }
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: auth,
      },
      t,
    )
    if (okResponse(response)) return mediaUrl
  } catch {
    return null
  }
  return null
}

/**
 * 将 URL 统一处理为无尾斜杠格式。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** 仙宫云公网公式：https://{实例ID}-{端口}.container.x-gpu.com */
function isXgpuContainerPublicHost(hostname: string): boolean {
  return /\.container\.x-gpu\.com$/i.test(String(hostname || '').trim())
}

/** 仙宫云容器内网：http://{实例ID}-{端口}.c.x-gpu.com */
function isXgpuIntranetHost(hostname: string): boolean {
  return /\.c\.x-gpu\.com$/i.test(String(hostname || '').trim())
}

function hostnameFromBareBase(bare: string): string {
  const b = String(bare || '').trim().replace(/^\/+/, '')
  if (!b) return ''
  try {
    return new URL(/^https?:\/\//i.test(b) ? b : `http://${b}`).hostname
  } catch {
    return b.split('/')[0]?.split(':')[0] || ''
  }
}

/**
 * 云端 Comfy 执行层地址（设置里展示可保留用户原文）。
 * - 仙宫云 **公网** `*.container.x-gpu.com`：按文档统一为 **https://**（无协议时自动补全）。
 * - 仙宫云 **内网** `*.c.x-gpu.com`：按文档统一为 **http://**。
 * - 其它云：去掉 https/http 前缀后按 **http://** 访问（兼容部分仅开 HTTP 的代理说明）。
 */
export function effectiveCloudComfyBaseUrl(stored: string): string {
  const s = normalizeBaseUrl(String(stored || ''))
  if (!s) return ''
  const bare = s.replace(/^https:\/\//i, '').replace(/^http:\/\//i, '').replace(/^\/+/, '')
  if (!bare) return ''
  const host = hostnameFromBareBase(bare)
  if (isXgpuContainerPublicHost(host)) {
    return `https://${bare}`
  }
  if (isXgpuIntranetHost(host)) {
    return `http://${bare}`
  }
  return `http://${bare}`
}

/**
 * 无协议时补全 scheme；仙宫云域名与 effectiveCloudComfyBaseUrl 规则一致。
 */
function absolutizeComfyBaseForFetch(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return normalized
  if (/^https?:\/\//i.test(normalized)) return normalized
  const bare = normalized.replace(/^\/+/, '')
  const host = hostnameFromBareBase(bare)
  if (isXgpuContainerPublicHost(host)) return `https://${bare}`
  if (isXgpuIntranetHost(host)) return `http://${bare}`
  return `http://${bare}`
}

/**
 * 是否走 Comfy 同源反代（开发 Vite 或打包态内置 HTTP 服务）。
 */
export function usesComfySameOriginProxy(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  if (!window.flowidDesktop) return false
  try {
    const { protocol, hostname } = window.location
    return protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost')
  } catch {
    return false
  }
}

/**
 * 本地 ComfyUI 在浏览器直连时可能触发 CORS/PNA，开发态走 Vite 同源代理更稳定。
 * 远程 http(s) Comfy（如云 GPU）在开发态同样走 `/__comfy_dev_proxy__/` 同源反代，避免上传/轮询被 CORS 拦截。
 * 打包桌面端经内置 HTTP 服务加载时，与开发态共用同一套反代路径。
 */
export function resolveRequestBase(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const absolute = absolutizeComfyBaseForFetch(normalized)
  if (!usesComfySameOriginProxy()) {
    return absolute
  }
  const baseOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://127.0.0.1'
  try {
    const url = new URL(absolute, baseOrigin)
    const isLocalHost =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    const isDefaultComfyPort = url.port === '8188'
    if (isLocalHost && isDefaultComfyPort) {
      return '/__comfy_local__'
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      // 始终走同源代理：仙宫云 Comfy 通常不返回 CORS，直连会 Failed to fetch；502 由 Vite 上游 TLS 配置解决
      const segment = normalizeBaseUrl(url.toString())
      return `/__comfy_dev_proxy__/${encodeComfyDevProxyBaseSegment(segment)}`
    }
  } catch {
    // ignore
  }
  return absolute
}

function getJsonHeaders(config: WorkflowProviderConfig): HeadersInit {
  if (!config.apiKey?.trim()) {
    return { 'Content-Type': 'application/json' }
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey.trim()}`,
  }
}

export function getAuthHeaders(config: WorkflowProviderConfig): HeadersInit {
  if (!config.apiKey?.trim()) {
    return {}
  }
  return {
    Authorization: `Bearer ${config.apiKey.trim()}`,
  }
}

/**
 * 从 history 条目中取 `outputs`（部分服务误写为 `output`）。
 */
function normalizeHistoryOutputs(entry: Record<string, unknown>): Record<string, unknown> | null {
  const raw =
    (entry.outputs as Record<string, unknown> | undefined) ??
    (entry.output as Record<string, unknown> | undefined)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw
}

/**
 * UUID 比较（忽略大小写，避免 submit 与 history 键大小写不一致导致永远匹配不到）。
 */
function uuidStringsLooselyEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * 判断条目是否属于本次 `prompt_id`（兼容 `prompt` 元组第二段为 uuid）。
 */
function entryMatchesPrompt(entry: Record<string, unknown>, promptIdTrimmed: string): boolean {
  const pid = promptIdTrimmed
  const directPromptId = entry.prompt_id
  if (typeof directPromptId === 'string' && uuidStringsLooselyEqual(directPromptId, pid)) return true
  const promptField = entry.prompt
  if (Array.isArray(promptField)) {
    return promptField.some(
      (item) => typeof item === 'string' && uuidStringsLooselyEqual(item, pid),
    )
  }
  return false
}

/**
 * 顶层 key 是否像 Comfy 默认的「uuid → 条目」整表结构。
 */
function payloadLooksLikeUuidKeyedHistoryMap(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).some((k) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k),
  )
}

/**
 * 从历史记录对象中按 promptId 查找对应任务条目。
 * 兼容 `/history/{id}` 与 `/history`、以及**网关直接返回单条目**（无外层 uuid 键）的形态。
 */
function resolveHistoryEntryByPromptId(
  payload: Record<string, unknown>,
  promptId: string,
): Record<string, unknown> | null {
  const pid = promptId.trim()
  if (!pid) return null

  const wrapped = payloadLooksLikeUuidKeyedHistoryMap(payload)
  const hasOutputsLike =
    payload.outputs !== undefined || (payload as { output?: unknown }).output !== undefined

  /** 单条目：`{ prompt, outputs|output, status }`，常见于反代把 `/history/{id}` 解包成 JSON 体 */
  if (!wrapped && hasOutputsLike && entryMatchesPrompt(payload as Record<string, unknown>, pid)) {
    return payload as Record<string, unknown>
  }

  const keySameCase = Object.keys(payload).find((k) => uuidStringsLooselyEqual(k, pid))
  if (keySameCase && typeof payload[keySameCase] === 'object' && !Array.isArray(payload[keySameCase])) {
    return payload[keySameCase] as Record<string, unknown>
  }
  if (payload[pid] && typeof payload[pid] === 'object' && !Array.isArray(payload[pid])) {
    return payload[pid] as Record<string, unknown>
  }
  for (const value of Object.values(payload)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    if (entryMatchesPrompt(entry, pid)) {
      return entry
    }
  }
  return null
}

/**
 * 从全量 `/history` 中收集与 `prompt_id` 匹配的条目（用于二次解析）。
 */
function collectHistoryEntriesMatchingPrompt(
  payload: Record<string, unknown>,
  promptId: string,
): Record<string, unknown>[] {
  const pid = promptId.trim()
  const list: Record<string, unknown>[] = []
  const seen = new Set<unknown>()

  const push = (e: Record<string, unknown>) => {
    if (seen.has(e)) return
    seen.add(e)
    list.push(e)
  }

  if (!payloadLooksLikeUuidKeyedHistoryMap(payload) && entryMatchesPrompt(payload as Record<string, unknown>, pid)) {
    push(payload as Record<string, unknown>)
  }
  const directKey = Object.keys(payload).find((k) => uuidStringsLooselyEqual(k, pid))
  const direct = (directKey && payload[directKey]) || payload[pid]
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    push(direct as Record<string, unknown>)
  }
  for (const value of Object.values(payload)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    if (entryMatchesPrompt(entry, pid)) push(entry)
  }
  return list
}

/**
 * 提取 history 条目的创建时间（毫秒）。优先 `prompt[3].create_time`，其次 `create_time`。
 */
function getHistoryEntryCreateTime(entry: Record<string, unknown>): number | null {
  const p = entry.prompt
  if (Array.isArray(p) && p.length >= 4) {
    const meta = p[3]
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      const v = (meta as Record<string, unknown>).create_time
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') {
        const n = Number(v)
        if (Number.isFinite(n)) return n
      }
    }
  }
  const direct = entry.create_time
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  if (typeof direct === 'string') {
    const n = Number(direct)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * 稳定序列化：对象键按字典序输出，避免运行时 key 顺序差异导致摘要不稳定。
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const keys = Object.keys(rec).sort((a, b) => a.localeCompare(b))
    const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')
    return `{${body}}`
  }
  return JSON.stringify(String(value))
}

/**
 * 轻量 hash（FNV-1a 32bit）用于并发任务指纹比对。
 */
function hashStringFNV1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 对提交给 Comfy 的 prompt 对象生成稳定摘要。
 */
export function buildComfyPromptDigest(prompt: Record<string, unknown>): string {
  return hashStringFNV1a(stableStringify(prompt))
}

/**
 * 从 history 条目里提取 prompt 对象（兼容 Comfy `[idx, prompt_id, promptObj, ...]` 结构）。
 */
function extractPromptObjectFromHistoryEntry(
  entry: Record<string, unknown>,
): Record<string, unknown> | null {
  const p = entry.prompt
  if (!Array.isArray(p)) return null
  const obj = p[2]
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  return obj as Record<string, unknown>
}

function matchesTaskFingerprint(
  entry: Record<string, unknown>,
  fingerprint?: ComfyHistoryTaskFingerprint,
): boolean {
  if (!fingerprint?.promptDigest) return true
  const promptObj = extractPromptObjectFromHistoryEntry(entry)
  if (!promptObj) return false
  const digest = buildComfyPromptDigest(promptObj)
  return digest === fingerprint.promptDigest
}

/**
 * 当 submit 返回的 `prompt_id` 与 history 中实际落盘 id 不一致时，
 * 从「提交时刻之后」挑选最新的可用条目兜底，避免轮询永远卡住。
 */
function pickLatestReadyEntryAfterSubmit(
  payload: Record<string, unknown>,
  expectation: ComfyHistoryResultExpectation,
  submittedAtMs?: number,
  fingerprint?: ComfyHistoryTaskFingerprint,
): Record<string, unknown> | null {
  const candidates = Object.values(payload).filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  ) as Record<string, unknown>[]
  const readyWithinWindow: Array<{ entry: Record<string, unknown>; ts: number }> = []
  let bestFingerprint: { entry: Record<string, unknown>; ts: number } | null = null
  for (const entry of candidates) {
    if (!isHistoryEntryReady(entry, expectation)) continue
    const ts = getHistoryEntryCreateTime(entry) ?? 0
    if (typeof submittedAtMs === 'number' && Number.isFinite(submittedAtMs)) {
      // 允许最多回看 3 秒，容忍客户端/服务端时钟轻微偏差。
      if (ts && ts + 3000 < submittedAtMs) continue
    }
    readyWithinWindow.push({ entry, ts })
    if (matchesTaskFingerprint(entry, fingerprint)) {
      if (!bestFingerprint || ts >= bestFingerprint.ts) bestFingerprint = { entry, ts }
    }
  }
  if (bestFingerprint) return bestFingerprint.entry

  /**
   * 并发安全优先使用指纹；但在「单任务场景」下若指纹缺失/不稳定，
   * 且时间窗口内仅有 1 条可用结果，直接认领给当前节点，避免无限卡住。
   */
  if (readyWithinWindow.length === 1) {
    return readyWithinWindow[0].entry
  }
  return null
}

/**
 * 图/视频：若首轮 history 条目未解析出 view URL，再从全量 history 里取**最后一条**且已含栅格图的匹配条目（兼容 RunningHub 等延迟写 outputs）。
 */
export async function refetchHistoryEntryWithRasterVisual({
  providerConfig,
  promptId,
}: {
  providerConfig: WorkflowProviderConfig
  promptId: string
}): Promise<Record<string, unknown> | null> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const pid = promptId.trim()
  if (!pid) return null
  try {
    const response = await fetchWithTimeout(
      `${requestBase}/history`,
      { headers: getAuthHeaders(providerConfig) },
      Math.min(60000, Math.max(8000, (providerConfig.timeoutSec || 120) * 1000)),
    )
    if (!response.ok) return null
    const payload = (await response.json()) as Record<string, unknown>
    const matches = collectHistoryEntriesMatchingPrompt(payload, pid)
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const e = matches[i]
      const out = normalizeHistoryOutputs(e)
      if (out && historyOutputsContainRasterVisual(out)) return e
    }
  } catch {
    return null
  }
  return null
}

/**
 * 视频节点：全量 history 中选取已含 mp4/webm 成片且 completed 的条目（VHS 晚于 PreviewImage 写入）。
 */
export async function refetchHistoryEntryWithVideoOutput({
  providerConfig,
  promptId,
}: {
  providerConfig: WorkflowProviderConfig
  promptId: string
}): Promise<Record<string, unknown> | null> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const pid = promptId.trim()
  if (!pid) return null
  try {
    const response = await fetchWithTimeout(
      `${requestBase}/history`,
      { headers: getAuthHeaders(providerConfig) },
      Math.min(60000, Math.max(8000, (providerConfig.timeoutSec || 120) * 1000)),
    )
    if (!response.ok) return null
    const payload = (await response.json()) as Record<string, unknown>
    const matches = collectHistoryEntriesMatchingPrompt(payload, pid)
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const e = matches[i]
      if (!historyEntryCompleted(e)) continue
      if (historyEntryContainsVideoProduct(e)) return e
    }
  } catch {
    return null
  }
  return null
}

/**
 * 配音/音乐：首轮 `/history/{id}` 或条目解析时 outputs 尚未含音频引用（部分云端/反代晚写），
 * 再从全量 `/history` 取与 prompt 匹配且可解析出音频 view 的最新条目（对齐图/视频的二次拉取策略）。
 */
export async function refetchHistoryEntryWithAudioOutput({
  providerConfig,
  promptId,
}: {
  providerConfig: WorkflowProviderConfig
  promptId: string
}): Promise<Record<string, unknown> | null> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const pid = promptId.trim()
  if (!pid) return null
  try {
    const response = await fetchWithTimeout(
      `${requestBase}/history`,
      { headers: getAuthHeaders(providerConfig) },
      Math.min(60000, Math.max(8000, (providerConfig.timeoutSec || 120) * 1000)),
    )
    if (!response.ok) return null
    const payload = (await response.json()) as Record<string, unknown>
    const matches = collectHistoryEntriesMatchingPrompt(payload, pid)
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const e = matches[i]
      const out = normalizeHistoryOutputs(e)
      if (out && Object.keys(out).length > 0 && historyOutputsHaveAudioSignals(out)) {
        return e
      }
      if (pickComfyResultAudioUrl({ providerConfig, historyEntry: e })) return e
    }
  } catch {
    return null
  }
  return null
}

function collectAudioFileRefsFromAny(value: unknown, refs: ComfyAudioRef[]) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => collectAudioFileRefsFromAny(item, refs))
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.filename === 'string') {
    refs.push({
      filename: record.filename,
      subfolder:
        typeof record.subfolder === 'string' ? record.subfolder : undefined,
      type: typeof record.type === 'string' ? record.type : undefined,
    })
  }
  // 兼容部分节点返回 `name` 字段而非 `filename`。
  const nameField = typeof record.name === 'string' ? record.name : null
  if (
    nameField &&
    Array.from(AUDIO_FILE_EXTENSIONS).some((ext) =>
      nameField.toLowerCase().endsWith(ext),
    )
  ) {
    refs.push({
      filename: nameField,
      subfolder:
        typeof record.subfolder === 'string' ? record.subfolder : undefined,
      type: typeof record.type === 'string' ? record.type : undefined,
    })
  }
  // 兼容部分节点直接返回音频路径字符串（如 "audio/ComfyUI_00014_.flac"）。
  for (const raw of Object.values(record)) {
    if (typeof raw !== 'string') continue
    const lower = raw.toLowerCase()
    const isAudioLike = Array.from(AUDIO_FILE_EXTENSIONS).some((ext) =>
      lower.endsWith(ext),
    )
    if (!isAudioLike) continue
    const parsed = parseComfyPathLikeRef(raw)
    if (!parsed) continue
    refs.push({
      filename: parsed.filename,
      subfolder: parsed.subfolder,
      type:
        typeof record.type === 'string' && record.type.trim()
          ? record.type
          : parsed.type,
    })
  }
  Object.values(record).forEach((item) => collectAudioFileRefsFromAny(item, refs))
}

/** 带 Comfy `outputs` 节点 id，便于多路音频时优先取图序较后的最终节点（如 PreviewAudio 晚于 BatchGenerateSpeaker）。 */
type TaggedAudioRef = ComfyAudioRef & { sourceNodeKey?: string }

function collectAudioFileRefsFromNodeOutputWithKey(
  nodeKey: string,
  nodeOutput: unknown,
  refs: TaggedAudioRef[],
) {
  const start = refs.length
  collectAudioFileRefsFromAny(nodeOutput, refs as ComfyAudioRef[])
  for (let i = start; i < refs.length; i += 1) {
    refs[i] = { ...refs[i], sourceNodeKey: nodeKey }
  }
}

function collectTaggedAudioRefsFromHistoryEntry(historyEntry: Record<string, unknown>): TaggedAudioRef[] {
  const refs: TaggedAudioRef[] = []
  const outputs = normalizeHistoryOutputs(historyEntry)
  if (outputs) {
    for (const [nodeKey, nodeOutput] of Object.entries(outputs)) {
      if (!nodeOutput || typeof nodeOutput !== 'object' || Array.isArray(nodeOutput)) continue
      collectAudioFileRefsFromNodeOutputWithKey(nodeKey, nodeOutput, refs)
    }
  }
  collectAudioFileRefsFromAny(historyEntry, refs as ComfyAudioRef[])
  return refs
}

/** Comfy history 里 `prompt` 可能是 `[n, id, workflowDict]` 或直接是 workflow 对象 */
function extractWorkflowNodeMapFromHistory(entry: Record<string, unknown>): Record<string, unknown> | null {
  const p = entry.prompt
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    return p as Record<string, unknown>
  }
  if (Array.isArray(p) && p.length >= 3 && p[2] && typeof p[2] === 'object' && !Array.isArray(p[2])) {
    return p[2] as Record<string, unknown>
  }
  return null
}

/**
 * 最终落盘/试听节点（PreviewAudio、SaveAudio 等），用于在多条 temp 音频中优先取对白成片，而非 BatchGenerateSpeaker 短条。
 * TD 多人：`TDQwen3TTSMultiDialog` 常在 history 里直接带音频；图里另有 PreviewAudio 接在同一输出上时，
 * 若只标 Preview 为优先，并列 temp 时会因节点 id 更小而稳定压过 MultiDialog，易误选更短的试听条——故一并纳入。
 */
function collectAudioSinkNodeIdsFromHistory(entry: Record<string, unknown>): Set<string> {
  const wf = extractWorkflowNodeMapFromHistory(entry)
  const ids = new Set<string>()
  if (!wf) return ids
  for (const [nodeId, raw] of Object.entries(wf)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const cls = String((raw as Record<string, unknown>).class_type || '')
      .toLowerCase()
      .replace(/\s+/g, '')
    if (!cls) continue
    if (
      cls === 'previewaudio' ||
      cls.includes('previewaudio') ||
      cls === 'saveaudio' ||
      cls.includes('saveaudio')
    ) {
      ids.add(nodeId)
    }
    if (cls === 'tdqwen3ttsmultidialog' || (cls.includes('multidialog') && cls.includes('qwen'))) {
      ids.add(nodeId)
    }
  }
  return ids
}

/**
 * 多人对白图：合并后的整段音频通常由「DialogueInference → SaveAudio」直连落盘；
 * 其余 SaveAudio 往往挂在各路 VoiceDesign 上（短条/单路）。优先前者，避免误选最大节点 id 的槽位 SaveAudio。
 */
function collectSaveAudioNodeIdsFedByDialogueInference(entry: Record<string, unknown>): Set<string> {
  const wf = extractWorkflowNodeMapFromHistory(entry)
  const out = new Set<string>()
  if (!wf) return out
  const dialogueIds = new Set<string>()
  for (const [id, raw] of Object.entries(wf)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const ct = String((raw as Record<string, unknown>).class_type || '').trim()
    if (!ct) continue
    const norm = ct.replace(/\s+/g, '')
    if (
      norm === 'FB_Qwen3TTSDialogueInference' ||
      norm.includes('DialogueInference') ||
      /dialogue.*inference/i.test(ct)
    ) {
      dialogueIds.add(id)
    }
  }
  if (dialogueIds.size === 0) return out
  for (const [id, raw] of Object.entries(wf)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const ct = String((raw as Record<string, unknown>).class_type || '')
      .toLowerCase()
      .replace(/\s+/g, '')
    if (!ct.includes('saveaudio')) continue
    const ins = (raw as Record<string, unknown>).inputs
    if (!ins || typeof ins !== 'object' || Array.isArray(ins)) continue
    const audio = (ins as Record<string, unknown>).audio
    if (!Array.isArray(audio) || audio.length < 1) continue
    const srcId = String(audio[0] ?? '').trim()
    if (srcId && dialogueIds.has(srcId)) out.add(id)
  }
  return out
}

function audioRefIdentityKey(r: ComfyAudioRef): string {
  const t = String(r.type ?? '').trim().toLowerCase()
  const s = String(r.subfolder ?? '').trim().toLowerCase()
  const f = String(r.filename ?? '').trim().toLowerCase()
  return `${t}|${s}|${f}`
}

function outputNodeKeyNumeric(key: string | undefined): number {
  if (!key) return -1
  const n = Number.parseInt(key, 10)
  return Number.isFinite(n) ? n : -1
}

/** 同一文件只保留一条：按与 pickBestAudioRef 相同的优先级合并。 */
function dedupeTaggedAudioRefs(
  refs: TaggedAudioRef[],
  preferred: Set<string>,
  dialogueMergeSaveIds: Set<string>,
): TaggedAudioRef[] {
  const map = new Map<string, TaggedAudioRef>()
  for (const r of refs) {
    const k = audioRefIdentityKey(r)
    const ex = map.get(k)
    if (!ex) {
      map.set(k, r)
      continue
    }
    const c = compareTaggedAudioRefPriority(ex, r, preferred, dialogueMergeSaveIds)
    map.set(k, c <= 0 ? ex : r)
  }
  return [...map.values()]
}

/**
 * 与 `mediaRefRank` 对齐：优先 SaveAudio 等落在 output 的最终文件，避免误选 PreviewAudio
 * 等 `temp/ComfyUI_temp_*` 预览（常为不完整/时长与元数据不一致的短文件）。
 */
function audioRefRank(item: ComfyAudioRef): number {
  const normalize = (value: string | undefined) => (value || '').trim().toLowerCase()
  const t = normalize(item.type)
  const s = normalize(item.subfolder)
  if (t === 'output' || s === 'output' || s.startsWith('output/')) return 0
  if (t === 'temp' || s === 'temp' || s.startsWith('temp/')) return 1
  if (t === 'input' || s === 'input' || s.startsWith('input/')) return 3
  return 2
}

/** 同等级时略压低 Comfy 临时试听文件名（部分网关未正确标 type=temp） */
function audioTempFilenamePenalty(filename: string): number {
  const lower = String(filename || '').toLowerCase()
  if (lower.includes('comfyui_temp')) return 1
  return 0
}

function compareTaggedAudioRefPriority(
  a: TaggedAudioRef,
  b: TaggedAudioRef,
  preferred: Set<string>,
  dialogueMergeSaveIds: Set<string>,
): number {
  const ra = audioRefRank(a)
  const rb = audioRefRank(b)
  if (ra !== rb) return ra - rb
  /**
   * PreviewAudio 产出常为 `ComfyUI_temp_*.flac`，若先比 comfyui_temp 惩罚，会误把
   * BatchGenerateSpeaker 的短条排在真正的试听节点之前（你控制台里的 4 先于 7）。
   */
  if (dialogueMergeSaveIds.size > 0) {
    const ad = a.sourceNodeKey && dialogueMergeSaveIds.has(String(a.sourceNodeKey)) ? 1 : 0
    const bd = b.sourceNodeKey && dialogueMergeSaveIds.has(String(b.sourceNodeKey)) ? 1 : 0
    if (ad !== bd) return bd - ad
  }
  if (preferred.size > 0) {
    const ap = a.sourceNodeKey && preferred.has(String(a.sourceNodeKey)) ? 1 : 0
    const bp = b.sourceNodeKey && preferred.has(String(b.sourceNodeKey)) ? 1 : 0
    if (ap !== bp) return bp - ap
  }
  const pa = audioTempFilenamePenalty(a.filename)
  const pb = audioTempFilenamePenalty(b.filename)
  if (pa !== pb) return pa - pb
  const ka = outputNodeKeyNumeric(a.sourceNodeKey)
  const kb = outputNodeKeyNumeric(b.sourceNodeKey)
  if (ka !== kb) return kb - ka
  return 0
}

/** 与 pickBestAudioRef 同序：output > temp、PreviewAudio/SaveAudio 节点先于 comfyui_temp 惩罚、再数字节点 id */
function listSortedAudioCandidates(
  refs: TaggedAudioRef[],
  preferred: Set<string>,
  dialogueMergeSaveIds: Set<string>,
): TaggedAudioRef[] {
  const deduped = dedupeTaggedAudioRefs(refs, preferred, dialogueMergeSaveIds)
  const audioLike = deduped.filter((item) => {
    const filename = item.filename.toLowerCase()
    return Array.from(AUDIO_FILE_EXTENSIONS).some((ext) => filename.endsWith(ext))
  })
  return [...audioLike].sort((a, b) =>
    compareTaggedAudioRefPriority(a, b, preferred, dialogueMergeSaveIds),
  )
}

function audioTieBreakKey(
  r: TaggedAudioRef,
  preferred: Set<string>,
  dialogueMergeSaveIds: Set<string>,
): string {
  const dm =
    dialogueMergeSaveIds.size > 0 && r.sourceNodeKey && dialogueMergeSaveIds.has(String(r.sourceNodeKey))
      ? 1
      : 0
  const pr =
    preferred.size > 0 && r.sourceNodeKey && preferred.has(String(r.sourceNodeKey)) ? 1 : 0
  return `${audioRefRank(r)}|${dm}|${pr}|${audioTempFilenamePenalty(r.filename)}|${outputNodeKeyNumeric(r.sourceNodeKey)}`
}

function pickBestAudioRef(
  refs: TaggedAudioRef[],
  preferred: Set<string>,
  dialogueMergeSaveIds: Set<string>,
): TaggedAudioRef | null {
  const list = listSortedAudioCandidates(refs, preferred, dialogueMergeSaveIds)
  return list[0] ?? null
}

function headersInitToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  if (Array.isArray(h)) {
    for (const pair of h) {
      if (pair && pair.length >= 2) out[String(pair[0])] = String(pair[1])
    }
    return out
  }
  return { ...(h as Record<string, string>) }
}

/**
 * 探测 `/view?...` 对应文件大小（HEAD → Range → 桌面 openAiCompatFetch），用于多路 temp 音频并列时选最大文件。
 * 云端 outputs 键常为 UUID 时节点序号排序失效，字节数更可靠。
 */
async function probeComfyViewUrlByteLength(url: string, authHeaders: HeadersInit | undefined): Promise<number> {
  const tryHead = async (credentials: RequestCredentials) => {
    const r = await fetchWithTimeout(url, { method: 'HEAD', headers: authHeaders, credentials }, 12_000)
    if (!r.ok) return 0
    const cl = r.headers.get('content-length')
    if (!cl) return 0
    const n = Number.parseInt(cl, 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  let n = await tryHead('include').catch(() => 0)
  if (n > 0) return n
  n = await tryHead('omit').catch(() => 0)
  if (n > 0) return n

  const flat = headersInitToRecord(authHeaders)
  const tryRange = async (credentials: RequestCredentials) => {
    const r = await fetchWithTimeout(
      url,
      { headers: { ...flat, Range: 'bytes=0-0' }, credentials },
      12_000,
    )
    if (r.status !== 206) return 0
    const cr = r.headers.get('content-range')
    const m = cr && /\/(\d+)\s*$/.exec(cr)
    if (!m) return 0
    const v = Number.parseInt(m[1], 10)
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  n = await tryRange('include').catch(() => 0)
  if (n > 0) return n
  n = await tryRange('omit').catch(() => 0)
  if (n > 0) return n

  const desk = typeof window !== 'undefined' ? window.flowidDesktop : undefined
  if (desk?.openAiCompatFetch) {
    try {
      const r = await desk.openAiCompatFetch({
        url,
        method: 'GET',
        headers: {
          Accept: '*/*',
          ...flat,
          Referer: typeof window !== 'undefined' ? window.location.href : '',
          Origin: typeof window !== 'undefined' ? window.location.origin : '',
        },
      })
      if (r.ok && 'body' in r && r.body.byteLength > 0) return r.body.byteLength
    } catch {
      /* ignore */
    }
  }
  return 0
}

const MAX_AUDIO_LENGTH_PROBE = 12

/** 开发构建默认打印；生产可在控制台执行：localStorage.setItem('flowid.debugComfyAudio','1') 后刷新 */
function shouldLogComfyAudioPickDebug(): boolean {
  if (import.meta.env.DEV) return true
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('flowid.debugComfyAudio') === '1'
  } catch {
    return false
  }
}

function classTypeForWorkflowNodeId(
  historyEntry: Record<string, unknown>,
  nodeKey: string | undefined,
): string {
  if (!nodeKey) return ''
  const wf = extractWorkflowNodeMapFromHistory(historyEntry)
  if (!wf) return ''
  const raw = wf[nodeKey]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  return String((raw as Record<string, unknown>).class_type || '').trim()
}

function logComfyAudioPickDebug(args: {
  stage: 'pick-async' | 'pick-latest-fallback'
  historyEntry: Record<string, unknown>
  rawRefCount: number
  filteredCount: number
  preferred: Set<string>
  dialogueMergeSaveIds: Set<string>
  sorted: TaggedAudioRef[]
  tied: TaggedAudioRef[]
  measured: Array<{ outputsNodeId?: string; classType: string; filename: string; bytes: number; urlShort: string }>
  chosen: TaggedAudioRef
  finalUrl: string
  tieKey: string
}) {
  if (!shouldLogComfyAudioPickDebug()) return
  const out = normalizeHistoryOutputs(args.historyEntry)
  const outKeys = out ? Object.keys(out) : []
  const urlShort =
    args.finalUrl.length > 200 ? `${args.finalUrl.slice(0, 200)}…(共${args.finalUrl.length}字符)` : args.finalUrl
  console.info('[Flowid Comfy · 音频结果选取调试]', {
    阶段: args.stage,
    说明: '生产环境调试请执行：localStorage.setItem("flowid.debugComfyAudio","1") 后刷新（开发构建默认已打印）',
    history里outputs的节点键: outKeys,
    工作流中认定的试听落盘节点id_PreviewAudio_SaveAudio: [...args.preferred],
    DialogueInference直连SaveAudio_整段对白优先: [...args.dialogueMergeSaveIds],
    从history收集到的音频引用条数_过滤前: args.rawRefCount,
    过滤上传参考等同名后: args.filteredCount,
    并列分组键_同键才比文件大小: args.tieKey,
    排序后候选_最多列12条: args.sorted.slice(0, 12).map((r, i) => ({
      排序: i + 1,
      outputs节点id: r.sourceNodeKey ?? '（全条目扫描无节点id）',
      class_type: classTypeForWorkflowNodeId(args.historyEntry, r.sourceNodeKey),
      filename: r.filename,
      type: r.type ?? '',
      subfolder: r.subfolder ?? '',
      rank输出优先: audioRefRank(r),
      comfyui_temp惩罚: audioTempFilenamePenalty(r.filename),
      数字节点键排序值: outputNodeKeyNumeric(r.sourceNodeKey),
      命中优先试听节点: Boolean(r.sourceNodeKey && args.preferred.has(String(r.sourceNodeKey))),
      命中对白合并落盘节点: Boolean(
        r.sourceNodeKey && args.dialogueMergeSaveIds.has(String(r.sourceNodeKey)),
      ),
    })),
    本档并列需测字节时_探测结果: args.measured,
    最终选用: {
      outputs节点id: args.chosen.sourceNodeKey ?? '（无）',
      class_type: classTypeForWorkflowNodeId(args.historyEntry, args.chosen.sourceNodeKey),
      filename: args.chosen.filename,
      type: args.chosen.type ?? '',
      subfolder: args.chosen.subfolder ?? '',
    },
    finalViewUrl: urlShort,
  })
}

async function resolveBestComfyAudioViewUrl(args: {
  providerConfig: WorkflowProviderConfig
  requestBase: string
  filteredRefs: TaggedAudioRef[]
  preferred: Set<string>
  historyEntry: Record<string, unknown>
  rawRefCount: number
  debugStage: 'pick-async' | 'pick-latest-fallback'
}): Promise<string | null> {
  const dialogueMergeSaveIds = collectSaveAudioNodeIdsFedByDialogueInference(args.historyEntry)
  const sorted = listSortedAudioCandidates(
    args.filteredRefs,
    args.preferred,
    dialogueMergeSaveIds,
  )
  if (!sorted.length) {
    if (shouldLogComfyAudioPickDebug()) {
      const out = normalizeHistoryOutputs(args.historyEntry)
      console.warn('[Flowid Comfy · 音频结果选取调试]', {
        阶段: args.debugStage,
        结果: '无可用音频候选（过滤后为空或 history 中无音频扩展名）',
        history里outputs的节点键: out ? Object.keys(out) : [],
        从history收集到的音频引用条数_过滤前: args.rawRefCount,
        过滤后: args.filteredRefs.length,
        优先试听节点id: [...args.preferred],
        DialogueInference直连SaveAudio: [...dialogueMergeSaveIds],
      })
    }
    return null
  }
  const top = sorted[0]!
  const key = audioTieBreakKey(top, args.preferred, dialogueMergeSaveIds)
  const tied = sorted
    .filter((r) => audioTieBreakKey(r, args.preferred, dialogueMergeSaveIds) === key)
    .slice(0, MAX_AUDIO_LENGTH_PROBE)
  let chosen = top
  let measuredRows: Array<{
    outputsNodeId?: string
    classType: string
    filename: string
    bytes: number
    urlShort: string
  }> = []
  if (tied.length > 1) {
    const headers = getAuthHeaders(args.providerConfig)
    const measured = await Promise.all(
      tied.map(async (r) => {
        const u = buildComfyViewUrl(args.requestBase, r)
        const len = await probeComfyViewUrlByteLength(u, headers)
        return { r, len, u }
      }),
    )
    measuredRows = measured.map((m) => ({
      outputsNodeId: m.r.sourceNodeKey,
      classType: classTypeForWorkflowNodeId(args.historyEntry, m.r.sourceNodeKey),
      filename: m.r.filename,
      bytes: m.len,
      urlShort: m.u.length > 120 ? `${m.u.slice(0, 120)}…` : m.u,
    }))
    const best = measured.reduce((a, b) => (b.len > a.len ? b : a))
    if (best.len > 0) chosen = best.r
  } else {
    const r = tied[0]!
    const u = buildComfyViewUrl(args.requestBase, r)
    const headers = getAuthHeaders(args.providerConfig)
    const len = await probeComfyViewUrlByteLength(u, headers)
    measuredRows = [
      {
        outputsNodeId: r.sourceNodeKey,
        classType: classTypeForWorkflowNodeId(args.historyEntry, r.sourceNodeKey),
        filename: r.filename,
        bytes: len,
        urlShort: u.length > 120 ? `${u.slice(0, 120)}…` : u,
      },
    ]
  }
  const params = new URLSearchParams({
    filename: chosen.filename,
    subfolder: chosen.subfolder ?? '',
    type: chosen.type ?? 'output',
  })
  const finalUrl = `${args.requestBase}/view?${params.toString()}`
  logComfyAudioPickDebug({
    stage: args.debugStage,
    historyEntry: args.historyEntry,
    rawRefCount: args.rawRefCount,
    filteredCount: args.filteredRefs.length,
    preferred: args.preferred,
    dialogueMergeSaveIds,
    sorted,
    tied,
    measured: measuredRows,
    chosen,
    finalUrl,
    tieKey: key,
  })
  return finalUrl
}

function collectMediaRefsFromAny(value: unknown, refs: ComfyMediaRef[]) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaRefsFromAny(item, refs))
    return
  }
  const record = value as Record<string, unknown>
  if (String(record.type || '').toLowerCase() === 'video' && typeof record.video === 'string') {
    const parsed = parseComfyPathLikeRef(record.video)
    if (parsed) {
      refs.push({
        filename: parsed.filename,
        subfolder: parsed.subfolder,
        type: parsed.type ?? 'output',
      })
    }
  }
  if (typeof record.filename === 'string') {
    const filenameLower = record.filename.toLowerCase()
    const isMediaLike = Array.from(MEDIA_FILE_EXTENSIONS).some((ext) =>
      filenameLower.endsWith(ext),
    )
    if (isMediaLike) {
      refs.push({
        filename: record.filename,
        subfolder:
          typeof record.subfolder === 'string' ? record.subfolder : undefined,
        type: typeof record.type === 'string' ? record.type : undefined,
      })
    }
  }
  for (const raw of Object.values(record)) {
    if (typeof raw !== 'string') continue
    const lower = raw.toLowerCase()
    const isMediaLike = Array.from(MEDIA_FILE_EXTENSIONS).some((ext) =>
      lower.endsWith(ext),
    )
    if (!isMediaLike) continue
    const parsed = parseComfyPathLikeRef(raw)
    if (!parsed) continue
    refs.push({
      filename: parsed.filename,
      subfolder: parsed.subfolder,
      type:
        typeof record.type === 'string' && record.type.trim()
          ? record.type
          : parsed.type,
    })
  }
  Object.values(record).forEach((item) => collectMediaRefsFromAny(item, refs))
}

function mediaRefRank(item: ComfyMediaRef): number {
  const normalize = (value: string | undefined) => (value || '').trim().toLowerCase()
  const t = normalize(item.type)
  const s = normalize(item.subfolder)
  // 1) 明确 output：优先使用 SaveImage/SaveVideo 的最终产物
  if (t === 'output' || s === 'output' || s.startsWith('output/')) return 0
  // 2) temp 预览：可显示但可能被后续清理
  if (t === 'temp' || s === 'temp' || s.startsWith('temp/')) return 1
  // 3) input：一般是上传参考图，不应作为回填结果
  if (t === 'input' || s === 'input' || s.startsWith('input/')) return 3
  // 4) 未标注类型：放在 output/temp 之后、input 之前
  return 2
}

function pickFirstMediaRef(refs: ComfyMediaRef[]): ComfyMediaRef | null {
  if (!refs.length) return null
  return [...refs].sort((a, b) => mediaRefRank(a) - mediaRefRank(b))[0] ?? refs[0]
}

function mediaRefDedupeKey(ref: ComfyMediaRef): string {
  const t = String(ref.type || '').trim().toLowerCase()
  const s = String(ref.subfolder || '').trim().toLowerCase()
  const f = String(ref.filename || '').trim().toLowerCase()
  return `${t}|${s}|${f}`
}

function buildComfyViewUrl(requestBase: string, ref: ComfyMediaRef): string {
  const params = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder ?? '',
    type: ref.type ?? 'output',
  })
  return `${requestBase}/view?${params.toString()}`
}

/**
 * 从 `/view?...` URL 中提取 filename 参数，失败返回空串。
 */
export function readFilenameFromComfyViewUrl(viewUrl: string | null | undefined): string {
  const raw = String(viewUrl || '').trim()
  if (!raw) return ''
  try {
    const absolute = raw.startsWith('http')
      ? raw
      : `${typeof window !== 'undefined' ? window.location.origin : ''}${raw.startsWith('/') ? '' : '/'}${raw}`
    const parsed = new URL(absolute)
    return String(parsed.searchParams.get('filename') || '').trim()
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

/**
 * 从 ComfyUI history 收集与 `pickComfyResultImageUrl` 同源的视觉类 refs（outputs → ui → 可选全条目扫描）。
 */
function collectComfyHistoryVisualRefsForResult(
  historyEntry: Record<string, unknown>,
  allowFullEntryFallback: boolean,
): ComfyMediaRef[] {
  const pushImageLikeRefs = (nodeOutput: Record<string, unknown>, target: ComfyMediaRef[]) => {
    pushComfyOutputNodeMediaArrays(nodeOutput, target, { includeRasterImages: true })
  }

  const refs: ComfyMediaRef[] = []
  const outputs = normalizeHistoryOutputs(historyEntry)
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    const visitOutputs = (value: unknown, depth: number) => {
      if (depth > DEEP_OUTPUT_SCAN_MAX_DEPTH || value == null) return
      if (Array.isArray(value)) {
        for (const item of value) visitOutputs(item, depth + 1)
        return
      }
      if (typeof value !== 'object') return
      pushImageLikeRefs(value as Record<string, unknown>, refs)
      for (const child of Object.values(value as Record<string, unknown>)) {
        visitOutputs(child, depth + 1)
      }
    }
    visitOutputs(outputs, 0)
  }
  if (refs.length) return refs

  const ui = historyEntry.ui as Record<string, unknown> | undefined
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    collectMediaRefsFromAny(ui, refs)
  }
  if (refs.length) return refs

  if (!allowFullEntryFallback) return []
  const fallbackRefs: ComfyMediaRef[] = []
  collectMediaRefsFromAny(historyEntry, fallbackRefs)
  return fallbackRefs
}

/**
 * 工作流是否含 VHS 成片节点（图生视频/配音轨等常见）。
 * @param {Record<string, unknown>} prompt
 */
export function promptHasVhsVideoCombineNode(prompt: Record<string, unknown>): boolean {
  for (const raw of Object.values(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const ct = String((raw as Record<string, unknown>).class_type || '')
    if (/VHS_VideoCombine/i.test(ct)) return true
  }
  return false
}

/**
 * 工作流是否含 Wan 首尾帧视频节点。
 * @param {Record<string, unknown>} prompt
 */
export function promptHasWanFirstLastFrameToVideoNode(prompt: Record<string, unknown>): boolean {
  for (const raw of Object.values(prompt)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const ct = String((raw as Record<string, unknown>).class_type || '')
    if (/WanFirstLastFrameToVideo/i.test(ct)) return true
  }
  return false
}

/**
 * 仅从 VHS_VideoCombine / PreviewImage 等「展示用输出节点」收集 history 视觉产物，
 * 避免深度扫描把中间节点的 temp 引用也算进 FLOWID 输出条。
 * @param {Record<string, unknown>} historyEntry
 * @param {{ vhsVideosOnly?: boolean }} [options] 为 true 时只收 VHS 节点的 mp4/webm 等（不收 PreviewImage 中间帧 png）
 */
function pushComfyOutputNodeMediaArrays(
  rec: Record<string, unknown>,
  target: ComfyMediaRef[],
  opts: { vhsVideosOnly?: boolean; includeRasterImages?: boolean },
): void {
  const pushRef = (item: ComfyImageRef) => {
    const filename = String(item.filename ?? item.name ?? '').trim()
    if (!filename) return
    if (opts.vhsVideosOnly && !isComfyVideoFilename(filename)) return
    target.push({
      filename,
      subfolder: item.subfolder,
      type: item.type,
    })
  }
  const arrayKeys = ['images', 'gifs', 'videos', 'animated', 'files'] as const
  for (const key of arrayKeys) {
    if (key === 'images' && !opts.includeRasterImages) continue
    const arr = rec[key] as ComfyImageRef[] | undefined
    if (arr?.length) arr.forEach((item) => pushRef(item))
  }
  collectMediaRefsFromAny(rec, target)
}

function collectComfyVideoPublishVisualRefs(
  historyEntry: Record<string, unknown>,
  options?: { vhsVideosOnly?: boolean },
): ComfyMediaRef[] {
  const workflow = extractWorkflowNodeMapFromHistory(historyEntry)
  const outputs = normalizeHistoryOutputs(historyEntry)
  if (!outputs) return []
  const allowedNodeIds = new Set<string>()
  const vhsVideosOnly = options?.vhsVideosOnly === true
  if (workflow) {
    for (const [nodeId, raw] of Object.entries(workflow)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const ct = String((raw as Record<string, unknown>).class_type || '')
      if (vhsVideosOnly) {
        if (/VHS_VideoCombine/i.test(ct)) allowedNodeIds.add(nodeId)
      } else if (/PreviewImage/i.test(ct) || /VHS_VideoCombine/i.test(ct)) {
        allowedNodeIds.add(nodeId)
      }
    }
  }
  /** 反代/旧版 history 无 `prompt` 工作流时：扫描全部 outputs，避免 VHS 成片被漏掉 */
  if (allowedNodeIds.size === 0) {
    for (const nodeKey of Object.keys(outputs)) allowedNodeIds.add(nodeKey)
  }
  const refs: ComfyMediaRef[] = []
  for (const [nodeKey, nodeOutput] of Object.entries(outputs)) {
    if (!allowedNodeIds.has(nodeKey)) continue
    if (!nodeOutput || typeof nodeOutput !== 'object' || Array.isArray(nodeOutput)) continue
    pushComfyOutputNodeMediaArrays(nodeOutput as Record<string, unknown>, refs, {
      vhsVideosOnly,
      includeRasterImages: !vhsVideosOnly,
    })
  }
  return refs
}

/**
 * 从 history 的 outputs / ui / status 收集视频文件引用（不扫描 `prompt` 工作流 JSON，避免误匹配模板路径）。
 */
function collectVideoMediaRefsFromHistoryEntry(entry: Record<string, unknown>): ComfyMediaRef[] {
  const refs: ComfyMediaRef[] = []
  const out = normalizeHistoryOutputs(entry)
  if (out) collectMediaRefsFromAny(out, refs)
  const ui = entry.ui
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    collectMediaRefsFromAny(ui, refs)
  }
  const status = entry.status
  if (status && typeof status === 'object' && !Array.isArray(status)) {
    collectMediaRefsFromAny(status, refs)
  }
  const seen = new Set<string>()
  const videoOnly: ComfyMediaRef[] = []
  for (const r of refs) {
    if (!isComfyVideoFilename(r.filename)) continue
    const k = mediaRefDedupeKey(r)
    if (seen.has(k)) continue
    seen.add(k)
    videoOnly.push(r)
  }
  return videoOnly
}

function shouldLogComfyVideoPickDebug(): boolean {
  if (import.meta.env.DEV) return true
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('flowid.debugComfyVideo') === '1'
  } catch {
    return false
  }
}

function logComfyVideoPickDebug(args: {
  stage: string
  historyEntry: Record<string, unknown>
  chosenUrl: string | null
  tried: Record<string, unknown>
}): void {
  if (!shouldLogComfyVideoPickDebug()) return
  const out = normalizeHistoryOutputs(args.historyEntry)
  const outKeys = out ? Object.keys(out) : []
  const perNode: Record<string, string[]> = {}
  if (out) {
    for (const [k, v] of Object.entries(out)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue
      const rec = v as Record<string, unknown>
      const keys = Object.keys(rec).filter((x) => {
        const val = rec[x]
        return Array.isArray(val) && val.length > 0
      })
      if (keys.length) perNode[k] = keys
    }
  }
  const deep = collectVideoMediaRefsFromHistoryEntry(args.historyEntry)
  console.info('[Flowid Comfy · 视频结果选取调试]', {
    阶段: args.stage,
    说明: '生产环境可执行 localStorage.setItem("flowid.debugComfyVideo","1") 后刷新',
    history里outputs的节点键: outKeys,
    各节点非空输出字段: perNode,
    深度扫描到的视频文件: deep.map((r) => ({
      filename: r.filename,
      subfolder: r.subfolder ?? '',
      type: r.type ?? '',
    })),
    选取URL: args.chosenUrl || '（无）',
    尝试路径: args.tried,
  })
}

/**
 * 将 Comfy refs 转为 view URL 列表（按 output 优先、basename 去重）。
 */
function comfyPublishRefsToViewUrls(
  refs: ComfyMediaRef[],
  requestBase: string,
  exclude: Set<string>,
  maxItems: number,
): string[] {
  const ranked = [...refs]
    .filter((r) => mediaRefRank(r) < 3)
    .sort((a, b) => mediaRefRank(a) - mediaRefRank(b))
  const seenBasename = new Set<string>()
  const out: string[] = []
  for (const ref of ranked) {
    const refFn = String(ref.filename || '').trim()
    const baseKey = refFn.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
    if (!baseKey || seenBasename.has(baseKey)) continue
    seenBasename.add(baseKey)
    const url = buildComfyViewUrl(requestBase, ref)
    const fn = readFilenameFromComfyViewUrl(url)
    if (fn && exclude.has(fn)) continue
    out.push(url)
    if (out.length >= maxItems) break
  }
  return out
}

/**
 * Wan 首尾帧视频节点输出条：对齐 Comfy 的 PreviewImage + VHS 成片，并按文件名去重。
 */
export function pickWanFirstLastFrameResultViewUrls({
  providerConfig,
  historyEntry,
  excludeFilenames,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  excludeFilenames?: Iterable<string>
}): string[] {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const exclude = new Set(
    Array.from(excludeFilenames ?? [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )
  let refs = collectComfyVideoPublishVisualRefs(historyEntry)
  if (!refs.length) {
    refs = collectComfyHistoryVisualRefsForResult(historyEntry, true)
  }
  return comfyPublishRefsToViewUrls(refs, requestBase, exclude, 12)
}

/**
 * 画布「视频节点」输出条：优先 VHS/Wan 成片节点，排除中间 png 与无效 temp，减少黑块占位。
 * @param {Record<string, unknown>} [workflowPrompt] 本次提交的 workflow API 图（用于判断 VHS / Wan）
 */
export function pickComfyVideoNodeResultViewUrls({
  providerConfig,
  historyEntry,
  excludeFilenames,
  workflowPrompt,
  maxItems = 6,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  excludeFilenames?: Iterable<string>
  workflowPrompt?: Record<string, unknown>
  maxItems?: number
}): string[] {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const exclude = new Set(
    Array.from(excludeFilenames ?? [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )
  const cap = Math.max(1, Math.min(12, maxItems))
  const prompt =
    workflowPrompt && typeof workflowPrompt === 'object' && !Array.isArray(workflowPrompt)
      ? workflowPrompt
      : extractWorkflowNodeMapFromHistory(historyEntry) ?? {}
  const wan = promptHasWanFirstLastFrameToVideoNode(prompt)
  const vhs = promptHasVhsVideoCombineNode(prompt)

  if (wan) {
    const urls = pickWanFirstLastFrameResultViewUrls({
      providerConfig,
      historyEntry,
      excludeFilenames,
    })
    if (urls.length) return urls.slice(0, cap)
  }

  if (vhs) {
    let refs = collectComfyVideoPublishVisualRefs(historyEntry, { vhsVideosOnly: true })
    if (!refs.length) {
      refs = collectComfyVideoPublishVisualRefs(historyEntry)
    }
    const fromSink = comfyPublishRefsToViewUrls(refs, requestBase, exclude, cap)
    if (fromSink.length) return fromSink
  }

  const strip = pickComfyResultVideoStripUrls({
    providerConfig,
    historyEntry,
    excludeFilenames,
    maxItems: cap,
  })
  if (strip.length) return strip

  return pickComfyResultImageViewUrls({
    providerConfig,
    historyEntry,
    allowFullEntryFallback: true,
    excludeFilenames,
    omitStaticRasterFilenamesForVideoStrip: true,
    dedupeByFilenameBasename: true,
  }).slice(0, cap)
}

/**
 * 深度判断任意对象中是否包含指定 prompt_id。
 */
function deepContainsPromptId(value: unknown, promptId: string): boolean {
  if (typeof value === 'string') {
    return value === promptId
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  if (Array.isArray(value)) {
    return value.some((item) => deepContainsPromptId(item, promptId))
  }
  return Object.values(value).some((item) => deepContainsPromptId(item, promptId))
}

/**
 * 解析 `/queue` 返回，判断任务是否仍在排队/执行中。
 */
function resolveQueueTaskState(
  payload: Record<string, unknown>,
  promptId: string,
): 'running' | 'pending' | 'not_found' {
  const runningCandidates = [
    payload.queue_running,
    payload.running,
    payload.currently_running,
  ]
  for (const item of runningCandidates) {
    if (deepContainsPromptId(item, promptId)) {
      return 'running'
    }
  }
  const pendingCandidates = [
    payload.queue_pending,
    payload.pending,
    payload.queued,
  ]
  for (const item of pendingCandidates) {
    if (deepContainsPromptId(item, promptId)) {
      return 'pending'
    }
  }
  return 'not_found'
}

/** 轮询历史时期望的结果类型：决定「何时算就绪」，避免被中间节点/尺寸文本误判为已完成 */
export type ComfyHistoryResultExpectation = 'visual' | 'video' | 'audio' | 'general'
export type ComfyHistoryTaskFingerprint = {
  /** 提交前对 prompt 对象计算的摘要（用于并发时精确认领 history 条目） */
  promptDigest?: string
}

const RASTER_VISUAL_FILENAME_RE = /\.(png|jpe?g|webp|gif|bmp|mp4|mov|webm|avi|mkv)$/i

/**
 * 判断 `outputs` 里是否已出现可解析的媒体引用（含音频数组；用于 audio/general 路径）。
 */
function historyOutputsContainRenderableMedia(outputs: Record<string, unknown>): boolean {
  for (const nodeOutput of Object.values(outputs)) {
    if (!nodeOutput || typeof nodeOutput !== 'object' || Array.isArray(nodeOutput)) continue
    const rec = nodeOutput as Record<string, unknown>
    for (const key of ['images', 'gifs', 'videos', 'audio', 'audios'] as const) {
      const arr = rec[key]
      if (Array.isArray(arr) && arr.length > 0) return true
    }
    const refs: ComfyMediaRef[] = []
    collectMediaRefsFromAny(rec, refs)
    if (refs.length > 0) return true
  }
  return false
}

const DEEP_OUTPUT_SCAN_MAX_DEPTH = 14

/**
 * 深度扫描 Comfy `outputs` 子树：部分工作流/自定义节点会把 `images` 套在多层对象里。
 */
function deepOutputsContainRasterVisual(value: unknown, depth = 0): boolean {
  if (depth > DEEP_OUTPUT_SCAN_MAX_DEPTH || value == null) return false
  if (Array.isArray(value)) {
    return value.some((item) => deepOutputsContainRasterVisual(item, depth + 1))
  }
  if (typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  for (const key of ['images', 'gifs', 'videos'] as const) {
    const arr = rec[key] as ComfyImageRef[] | undefined
    if (
      Array.isArray(arr) &&
      arr.some((it) => String(it?.filename ?? it?.name ?? '').trim().length > 0)
    ) {
      return true
    }
  }
  const refs: ComfyMediaRef[] = []
  collectMediaRefsFromAny(rec, refs)
  if (refs.some((item) => RASTER_VISUAL_FILENAME_RE.test(item.filename))) return true
  return Object.values(rec).some((v) => deepOutputsContainRasterVisual(v, depth + 1))
}

/**
 * 图/视频节点：仅当存在栅格图或视频产物（不把仅有 `text: ["1371x765"]` 等当作完成）。
 */
function historyOutputsContainRasterVisual(outputs: Record<string, unknown>): boolean {
  return deepOutputsContainRasterVisual(outputs, 0)
}

/**
 * 图/视频节点成片：history 中是否已有可播放视频文件（mp4/webm 等），不含仅 PreviewImage 的 png。
 */
function historyOutputsContainVideoProduct(outputs: Record<string, unknown>): boolean {
  return deepOutputsContainVideoProduct(outputs, 0)
}

function historyEntryContainsVideoProduct(entry: Record<string, unknown>): boolean {
  const out = normalizeHistoryOutputs(entry)
  if (out && historyOutputsContainVideoProduct(out)) return true
  const ui = entry.ui
  if (ui && typeof ui === 'object' && !Array.isArray(ui) && historyUiContainVideoProduct(ui as Record<string, unknown>)) {
    return true
  }
  return collectVideoMediaRefsFromHistoryEntry(entry).length > 0
}

function deepOutputsContainVideoProduct(value: unknown, depth = 0): boolean {
  if (depth > DEEP_OUTPUT_SCAN_MAX_DEPTH || value == null) return false
  if (Array.isArray(value)) {
    return value.some((item) => deepOutputsContainVideoProduct(item, depth + 1))
  }
  if (typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  for (const key of ['images', 'gifs', 'videos'] as const) {
    const arr = rec[key] as ComfyImageRef[] | undefined
    if (
      Array.isArray(arr) &&
      arr.some((it) => isComfyVideoFilename(String(it?.filename ?? it?.name ?? '').trim()))
    ) {
      return true
    }
  }
  const refs: ComfyMediaRef[] = []
  collectMediaRefsFromAny(rec, refs)
  if (refs.some((item) => isComfyVideoFilename(item.filename))) return true
  return Object.values(rec).some((v) => deepOutputsContainVideoProduct(v, depth + 1))
}

function historyUiContainVideoProduct(ui: Record<string, unknown>): boolean {
  const refs: ComfyMediaRef[] = []
  collectMediaRefsFromAny(ui, refs)
  return refs.some((item) => isComfyVideoFilename(item.filename))
}

function historyEntryCompleted(entry: Record<string, unknown>): boolean {
  const status = entry.status
  return Boolean(
    status &&
      typeof status === 'object' &&
      !Array.isArray(status) &&
      (status as Record<string, unknown>).completed === true,
  )
}

/**
 * 轮询提前结束：视频任务必须解析出 mp4/webm view URL，避免 PreviewImage 的 png 导致过早返回。
 */
function canEndVisualHistoryPollEarly(
  expectation: ComfyHistoryResultExpectation,
  providerConfig: WorkflowProviderConfig,
  historyEntry: Record<string, unknown>,
): boolean {
  if (expectation === 'video') {
    const url = pickComfyResultVideoUrl({
      providerConfig,
      historyEntry,
      allowFullEntryFallback: false,
    })
    return Boolean(url)
  }
  if (expectation === 'visual') {
    return Boolean(
      pickComfyResultImageUrl({
        providerConfig,
        historyEntry,
        allowFullEntryFallback: false,
        preferVideoOutput: false,
      }),
    )
  }
  return false
}

function historyUiContainRasterVisual(ui: Record<string, unknown>): boolean {
  const refs: ComfyMediaRef[] = []
  collectMediaRefsFromAny(ui, refs)
  return refs.some((item) => RASTER_VISUAL_FILENAME_RE.test(item.filename))
}

/**
 * 判断 Comfy 写入的 `ui` 字段是否已带可展示的媒体（部分版本先写 ui 再补全 outputs）。
 */
function historyUiContainRenderableMedia(ui: Record<string, unknown>): boolean {
  const refs: ComfyMediaRef[] = []
  collectMediaRefsFromAny(ui, refs)
  return refs.length > 0
}

/**
 * 判断 outputs 是否「仅有类似 `1371x765` 的尺寸字符串」——常见于 SaveImage 前的中间节点，且可能伴随 `completed:true`。
 */
function historyOutputsAreOnlyDimensionLikeText(outputs: Record<string, unknown>): boolean {
  if (!outputs || Object.keys(outputs).length === 0) return false
  let sawText = false
  for (const nodeOutput of Object.values(outputs)) {
    if (!nodeOutput || typeof nodeOutput !== 'object' || Array.isArray(nodeOutput)) continue
    const rec = nodeOutput as Record<string, unknown>
    const keys = Object.keys(rec)
    if (keys.length === 0) continue
    if (!keys.every((k) => k === 'text')) return false
    for (const v of Object.values(rec)) {
      if (!Array.isArray(v)) return false
      for (const item of v) {
        if (typeof item !== 'string') return false
        sawText = true
        if (!/^\s*\d+\s*[x×]\s*\d+\s*$/i.test(item.trim())) return false
      }
    }
  }
  return sawText
}

function historyOutputsHaveAudioSignals(outputs: Record<string, unknown>): boolean {
  const refs: ComfyAudioRef[] = []
  for (const nodeOutput of Object.values(outputs)) {
    collectAudioFileRefsFromAny(nodeOutput, refs)
  }
  return refs.length > 0
}

function historyUiHasAudioSignals(ui: Record<string, unknown>): boolean {
  const refs: ComfyAudioRef[] = []
  collectAudioFileRefsFromAny(ui, refs)
  return refs.length > 0
}

/**
 * 判断历史条目是否已写入可消费结果，避免过早返回导致拿不到 outputs/audio。
 * @param expectation `visual`：必须已有图/视频产物（**不能**仅凭 `completed` 或仅有尺寸 text）；`video`：须 `completed` 且含 mp4/webm 成片；`audio`：优先音频；`general`：文本等，但排除「仅尺寸类 text」的假完成。
 */
function isHistoryEntryReady(
  entry: Record<string, unknown>,
  expectation: ComfyHistoryResultExpectation,
): boolean {
  const outObj = normalizeHistoryOutputs(entry)
  const ui = entry.ui
  const uiObj = ui && typeof ui === 'object' && !Array.isArray(ui) ? (ui as Record<string, unknown>) : null

  const completed = historyEntryCompleted(entry)

  if (expectation === 'video') {
    /**
     * 首尾帧 / VHS：PreviewImage 的 png 会先写入 history，须等任务 completed 且 VHS 的 mp4 落库。
     */
    if (!completed) return false
    return historyEntryContainsVideoProduct(entry)
  }

  if (expectation === 'visual') {
    if (outObj && Object.keys(outObj).length > 0 && historyOutputsContainRasterVisual(outObj)) {
      return true
    }
    if (uiObj && historyUiContainRasterVisual(uiObj)) return true
    return false
  }

  if (expectation === 'audio') {
    const hasAudioOut =
      Boolean(outObj && Object.keys(outObj).length > 0 && historyOutputsHaveAudioSignals(outObj))
    const hasAudioUi = Boolean(uiObj && historyUiHasAudioSignals(uiObj))
    if (!hasAudioOut && !hasAudioUi) return false
    /**
     * 必须等 `completed`，否则 TDQwen3TTSBatchGenerateSpeaker 等前置节点会先写入短试听，
     * 历史里一有音频就误判就绪，随后 `pickComfyResultAudioUrl` 会拿到非最终片段。
     */
    return completed === true
  }

  // general：文本/脚本等；排除「仅 completed + 尺寸 text」——否则会早于 SaveImage 落库就结束轮询
  if (outObj && Object.keys(outObj).length > 0 && historyOutputsContainRenderableMedia(outObj)) {
    return true
  }
  if (uiObj && historyUiContainRenderableMedia(uiObj)) return true
  if (completed && outObj && Object.keys(outObj).length > 0) {
    if (historyOutputsAreOnlyDimensionLikeText(outObj)) return false
    return true
  }
  return false
}

/**
 * 提交 ComfyUI prompt，并返回任务 id。
 */
export async function submitComfyPrompt({
  providerConfig,
  prompt,
}: {
  providerConfig: WorkflowProviderConfig
  prompt: Record<string, unknown>
}): Promise<string> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const headers = getJsonHeaders(providerConfig)
  const clientId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `flowid-${Date.now()}-${Math.random().toString(16).slice(2)}`
  /** Comfy 官方支持：便于 WebSocket 进度与队列条目和浏览器会话关联；缺省时部分云端面板会像「空任务」。 */
  const body = JSON.stringify({ prompt, client_id: clientId })
  const submitTimeoutMs = Math.max(8, providerConfig.timeoutSec || 30) * 1000
  /** 与上传接口一致：部分 ComfyUI / 反代仅暴露 `/api/prompt`，避免 404 时误以为未发任务 */
  let response: Response
  try {
    response = await fetchWithTimeout(
      `${requestBase}/prompt`,
      {
        method: 'POST',
        headers,
        body,
      },
      submitTimeoutMs,
    )
  } catch (error) {
    throw new Error(
      `无法连接到 ComfyUI（${baseUrl || '未配置地址'}），请检查服务是否在运行或地址是否正确：${(error as Error)?.message || '网络请求失败'}`,
    )
  }
  if (response.status === 404) {
    try {
      response = await fetchWithTimeout(
        `${requestBase}/api/prompt`,
        {
          method: 'POST',
          headers,
          body,
        },
        submitTimeoutMs,
      )
    } catch (error) {
      throw new Error(
        `无法连接到 ComfyUI（${baseUrl || '未配置地址'}），请检查服务是否在运行或地址是否正确：${(error as Error)?.message || '网络请求失败'}`,
      )
    }
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(
      `提交失败（${response.status}）${bodyText ? `：${bodyText}` : ''}`,
    )
  }
  const json = (await response.json()) as SubmitPromptResponse
  if (!json.prompt_id) {
    throw new Error('ComfyUI 返回缺少 prompt_id')
  }
  return String(json.prompt_id).trim()
}

/**
 * 轮询队列/历史时遇到不可恢复错误，抛出后由上层弹窗提示，避免无限请求。
 */
export class ComfyPollFatalError extends Error {
  override readonly name = 'ComfyPollFatalError'
}

/** 历史已落盘且 Comfy 明确报告失败/中断：与网络轮询异常区分，须立即向上抛出以更新节点 UI。 */
export class ComfyTaskFailedError extends Error {
  override readonly name = 'ComfyTaskFailedError'
}

/** 鉴权类 HTTP 状态：继续轮询无意义 */
function isComfyUnauthorizedStatus(status: number): boolean {
  return status === 401 || status === 403
}

function isComfyGpuOutOfMemoryMessage(msg: string): boolean {
  const lower = msg.toLowerCase()
  return (
    lower.includes('allocation on device') ||
    lower.includes('out of memory') ||
    lower.includes('cuda out of memory') ||
    lower.includes('ran out of memory') ||
    lower.includes('cudnncreate')
  )
}

/** 将 Comfy 原始报错转为更易读的 UI 文案（显存不足等常见场景附加排查提示） */
function enrichComfyExecutionErrorUserMessage(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (!isComfyGpuOutOfMemoryMessage(trimmed)) return trimmed.slice(0, 500)
  return [
    trimmed.slice(0, 400),
    '【GPU 显存不足】Wan2.2 SVI 加速稿默认按 16GB 显存设计（512×896 + 多段 SVI + RIFE×4）。',
    '可尝试：关闭其它占 GPU 的程序并重启 Comfy；在工作流里降低 Scale 分辨率（如 384×672）；RIFE 倍率 4→2；Comfy 以 --lowvram 启动。',
    '本工作流无 batch_size 节点，一般不是批量大小问题。',
  ].join('\n')
}

function pickComfyExecutionErrorUserMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload as Record<string, unknown>
  const msg = String(p.exception_message ?? p.message ?? '').trim()
  if (msg) return enrichComfyExecutionErrorUserMessage(msg)
  const typ = String(p.exception_type ?? '').trim()
  if (typ) return enrichComfyExecutionErrorUserMessage(typ)
  return null
}

/**
 * history 里已有对应 prompt 条目，但 Comfy 已标记失败/中断（无可用输出仍轮询会卡在「86% 等待就绪」）。
 */
function extractHistoryEntryTerminalFailureMessage(entry: Record<string, unknown>): string | null {
  const status = entry.status
  if (!status || typeof status !== 'object' || Array.isArray(status)) return null
  const st = status as Record<string, unknown>
  const statusStr = String(st.status_str || '').trim().toLowerCase()
  if (statusStr === 'error') {
    return pickComfyExecutionErrorUserMessage(st) || 'Comfy 报告任务失败'
  }
  const messages = st.messages
  if (!Array.isArray(messages)) return null
  for (const m of messages) {
    if (!Array.isArray(m) || m.length < 1) continue
    const head = String(m[0] || '').trim()
    if (head === 'execution_error') {
      return pickComfyExecutionErrorUserMessage(m[1]) || 'Comfy 执行错误'
    }
    if (head === 'execution_interrupted') {
      return 'Comfy 任务被中断'
    }
  }
  return null
}

/** 根据队列与历史就绪情况映射 UI 进度（近似值，非 Comfy 内部步数）。 */
function mapComfyWaitProgress(args: {
  queueState: 'running' | 'pending' | 'not_found'
  seenInQueue: boolean
  hasUnreadyEntry: boolean
  queueOk: boolean
}): NodeRunProgress {
  const { queueState, seenInQueue, hasUnreadyEntry, queueOk } = args
  if (hasUnreadyEntry) {
    return { percent: 86, label: '结果生成中，等待就绪…' }
  }
  if (queueState === 'pending') {
    return { percent: 18, label: '任务排队中…' }
  }
  if (queueState === 'running') {
    return { percent: 48, label: '任务执行中…' }
  }
  if (seenInQueue && queueState === 'not_found') {
    return { percent: 72, label: '已离开队列，等待历史落盘…' }
  }
  if (!queueOk) {
    return { percent: 12, label: '查询队列异常，继续拉取历史…' }
  }
  return { percent: 10, label: '等待调度与历史记录…' }
}

/**
 * 轮询任务历史，直到拿到本次 prompt 执行结果或超时。
 * 若连续多次无法拉取 `/history`、或连续发生网络/解析异常、或返回 401/403，则立即抛出 {@link ComfyPollFatalError}，不再空转请求。
 */
export async function waitComfyHistory({
  providerConfig,
  promptId,
  onProgress,
  submittedAtMs,
  taskFingerprint,
  /** 图/视频必须等 SaveImage 等真正落库，避免 `completed+仅尺寸 text` 提前结束 */
  resultExpectation = 'general',
}: {
  providerConfig: WorkflowProviderConfig
  promptId: string
  /** 轮询过程中上报近似进度，便于节点 UI 展示百分比 */
  onProgress?: (info: NodeRunProgress) => void
  /** submit 返回 prompt_id 时的客户端时间戳；用于 prompt_id 失配兜底 */
  submittedAtMs?: number
  /** 并发安全指纹：用于 `prompt_id` 失配时精确认领本次任务条目 */
  taskFingerprint?: ComfyHistoryTaskFingerprint
  resultExpectation?: ComfyHistoryResultExpectation
}): Promise<Record<string, unknown>> {
  const pid = promptId.trim()
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  // 视频任务可能持续 15 分钟以上，默认至少等待 20 分钟，避免过早超时报错。
  const effectiveTimeoutSec = Math.max(1200, providerConfig.timeoutSec || 120)
  const deadline = Date.now() + effectiveTimeoutSec * 1000
  /** 单次轮询请求超时，避免 Comfy 卡死时浏览器 `fetch` 永久挂起、界面停在「执行中」某百分比 */
  const ioQueueMs = 30_000
  const ioHistoryScopedMs = 45_000
  const ioHistoryFullMs = 180_000
  let lastStatus = '尚未收到历史响应'
  let seenInQueue = false
  let lastProgressKey = ''
  /** 连续整轮 try 内抛错（超时、断网、非 JSON 等），达到上限则中止 */
  let consecutiveIoExceptions = 0
  /** 连续多轮无法成功读取全量 `/history`（HTTP 非 2xx），达到上限则中止 */
  let consecutiveHistoryHttpFailures = 0
  const maxIoExceptionsBeforeAbort = 4
  const maxHistoryHttpFailuresBeforeAbort = 5
  const emitProgress = (info: NodeRunProgress) => {
    const key = `${info.percent}|${info.label}`
    if (key === lastProgressKey) return
    lastProgressKey = key
    onProgress?.(info)
  }
  while (Date.now() < deadline) {
    try {
      let queueState: 'running' | 'pending' | 'not_found' = 'not_found'
      let queueOk = false
      const queueResponse = await fetchWithTimeout(
        `${requestBase}/queue`,
        { headers: getAuthHeaders(providerConfig) },
        ioQueueMs,
      )
      if (queueResponse.ok) {
        queueOk = true
        const queueJson = (await queueResponse.json()) as Record<string, unknown>
        queueState = resolveQueueTaskState(queueJson, pid)
        if (queueState === 'running') {
          seenInQueue = true
          lastStatus = '任务执行中，等待历史写入...'
        } else if (queueState === 'pending') {
          seenInQueue = true
          lastStatus = '任务排队中，等待调度执行...'
        } else if (seenInQueue) {
          // 曾经在队列中，现已不在，通常表示已执行结束，等待 history 最终落盘。
          lastStatus = '任务已离开队列，等待历史记录落盘...'
        } else {
          lastStatus = '队列未找到任务，继续等待历史记录...'
        }
      } else {
        lastStatus = `/queue 返回 ${queueResponse.status}，继续查询历史...`
      }

      let hasUnreadyEntry = false
      const scopedResponse = await fetchWithTimeout(
        `${requestBase}/history/${encodeURIComponent(pid)}`,
        { headers: getAuthHeaders(providerConfig) },
        ioHistoryScopedMs,
      )
      if (scopedResponse.ok) {
        const scopedJson = (await scopedResponse.json()) as Record<string, unknown>
        const scopedEntry = resolveHistoryEntryByPromptId(scopedJson, pid)
        if (scopedEntry && isHistoryEntryReady(scopedEntry, resultExpectation)) {
          emitProgress({ percent: 88, label: '任务已完成，正在获取输出…' })
          return scopedEntry
        }
        if (
          (resultExpectation === 'visual' || resultExpectation === 'video') &&
          scopedEntry &&
          !isHistoryEntryReady(scopedEntry, resultExpectation) &&
          canEndVisualHistoryPollEarly(resultExpectation, providerConfig, scopedEntry)
        ) {
          emitProgress({ percent: 88, label: '任务已完成，正在获取输出…' })
          return scopedEntry
        }
        if (scopedEntry) {
          const failMsg = extractHistoryEntryTerminalFailureMessage(scopedEntry)
          if (failMsg) {
            throw new ComfyTaskFailedError(failMsg)
          }
          hasUnreadyEntry = true
          lastStatus = '已找到任务但结果尚未就绪'
        }
      } else {
        lastStatus = `history/${pid} 返回 ${scopedResponse.status}`
      }

      const fullResponse = await fetchWithTimeout(
        `${requestBase}/history`,
        { headers: getAuthHeaders(providerConfig) },
        ioHistoryFullMs,
      )

      if (
        isComfyUnauthorizedStatus(queueResponse.status) ||
        isComfyUnauthorizedStatus(scopedResponse.status) ||
        isComfyUnauthorizedStatus(fullResponse.status)
      ) {
        throw new ComfyPollFatalError(
          `Comfy 接口返回 401/403，鉴权失败或无权限（/queue=${queueResponse.status}，单条 history=${scopedResponse.status}，/history=${fullResponse.status}）。请检查设置中的 API Key、网关或服务端权限。`,
        )
      }

      if (!fullResponse.ok) {
        consecutiveHistoryHttpFailures += 1
        lastStatus = `/history 返回 ${fullResponse.status}`
        if (consecutiveHistoryHttpFailures >= maxHistoryHttpFailuresBeforeAbort) {
          throw new ComfyPollFatalError(
            `已连续 ${consecutiveHistoryHttpFailures} 次无法读取全量历史 /history（最近 HTTP ${fullResponse.status}）。请检查 Comfy 地址、反代路径是否正确，或服务是否可用。`,
          )
        }
      } else {
        consecutiveHistoryHttpFailures = 0
      }

      if (fullResponse.ok) {
        const fullJson = (await fullResponse.json()) as Record<string, unknown>
        const fullEntry = resolveHistoryEntryByPromptId(fullJson, pid)
        if (fullEntry && isHistoryEntryReady(fullEntry, resultExpectation)) {
          emitProgress({ percent: 88, label: '任务已完成，正在获取输出…' })
          return fullEntry
        }
        if (
          (resultExpectation === 'visual' || resultExpectation === 'video') &&
          fullEntry &&
          !isHistoryEntryReady(fullEntry, resultExpectation) &&
          canEndVisualHistoryPollEarly(resultExpectation, providerConfig, fullEntry)
        ) {
          emitProgress({ percent: 88, label: '任务已完成，正在获取输出…' })
          return fullEntry
        }
        if (fullEntry) {
          const failMsg = extractHistoryEntryTerminalFailureMessage(fullEntry)
          if (failMsg) {
            throw new ComfyTaskFailedError(failMsg)
          }
          hasUnreadyEntry = true
          lastStatus = '全量历史已找到任务但结果尚未就绪'
        } else if (queueState === 'not_found') {
          /**
           * 兜底：某些部署会出现 submit 返回的 prompt_id 与 history 落盘 id 不一致。
           * 当队列已空且完全匹配不到 prompt_id 时，尝试取「提交后最新就绪条目」。
           */
          const latestReady = pickLatestReadyEntryAfterSubmit(
            fullJson,
            resultExpectation,
            submittedAtMs,
            taskFingerprint,
          )
          if (latestReady) {
            emitProgress({ percent: 88, label: '任务已完成，正在获取输出…' })
            return latestReady
          }
        }
      }

      if (fullResponse.ok) {
        consecutiveIoExceptions = 0
      }

      emitProgress(
        mapComfyWaitProgress({
          queueState,
          seenInQueue,
          hasUnreadyEntry,
          queueOk,
        }),
      )
    } catch (error) {
      if (error instanceof ComfyPollFatalError) {
        throw error
      }
      if (error instanceof ComfyTaskFailedError) {
        throw error
      }
      consecutiveIoExceptions += 1
      lastStatus = (error as Error)?.message || '历史查询网络异常'
      if (consecutiveIoExceptions >= maxIoExceptionsBeforeAbort) {
        throw new ComfyPollFatalError(
          `已连续 ${consecutiveIoExceptions} 次请求队列/历史失败（网络中断、超时或非 JSON 响应等）：${lastStatus}`,
        )
      }
      emitProgress({ percent: 8, label: '网络异常，重试中…' })
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  throw new Error(
    `任务超时，未在历史记录中拿到可用结果（prompt_id=${pid}，${lastStatus}，等待${effectiveTimeoutSec}s）`,
  )
}

/**
 * 从 ComfyUI history 结果提取图片预览 URL（若有）。
 */
export function pickComfyResultImageUrl({
  providerConfig,
  historyEntry,
  /**
   * 为 false 时不扫描整条 history（含 `prompt` 工作流 JSON），避免误把模板里的文件名当成本次输出；
   * 轮询「就绪」探测时应传 false。
   */
  allowFullEntryFallback = true,
  /** 为 true 时优先返回 mp4/webm 等成片（图生视频/首尾帧工作流避免误选中间 png） */
  preferVideoOutput = false,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  allowFullEntryFallback?: boolean
  preferVideoOutput?: boolean
}): string | null {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const refs = collectComfyHistoryVisualRefsForResult(historyEntry, allowFullEntryFallback)
  const pool = preferVideoOutput
    ? refs.filter((r) => isComfyVideoFilename(r.filename))
    : refs
  const first = pickFirstMediaRef(pool.length ? pool : refs)
  if (!first) return null
  return buildComfyViewUrl(requestBase, first)
}

/**
 * 视频节点主预览：VHS 成片 → 深度扫描 outputs/ui/status → 通用 preferVideo 回退。
 */
export function pickComfyResultVideoUrl({
  providerConfig,
  historyEntry,
  allowFullEntryFallback = true,
  excludeFilenames,
  workflowPrompt,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  allowFullEntryFallback?: boolean
  excludeFilenames?: Iterable<string>
  workflowPrompt?: Record<string, unknown>
}): string | null {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const exclude = new Set(
    Array.from(excludeFilenames ?? [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )
  const tried: Record<string, unknown> = {}

  const strip = pickComfyVideoNodeResultViewUrls({
    providerConfig,
    historyEntry,
    excludeFilenames,
    workflowPrompt,
    maxItems: 1,
  })
  tried.VHS_Wan输出条 = strip.length
  if (strip[0]) {
    logComfyVideoPickDebug({ stage: 'vhs-strip', historyEntry, chosenUrl: strip[0], tried })
    return strip[0]!
  }

  const deepRefs = collectVideoMediaRefsFromHistoryEntry(historyEntry)
  tried.深度扫描视频数 = deepRefs.length
  const deepFirst = pickFirstMediaRef(deepRefs)
  if (deepFirst) {
    const url = buildComfyViewUrl(requestBase, deepFirst)
    const fn = readFilenameFromComfyViewUrl(url)
    if (!fn || !exclude.has(fn)) {
      logComfyVideoPickDebug({ stage: 'deep-scan', historyEntry, chosenUrl: url, tried })
      return url
    }
  }

  const generic = pickComfyResultImageUrl({
    providerConfig,
    historyEntry,
    allowFullEntryFallback,
    preferVideoOutput: true,
  })
  tried.通用preferVideo = generic ? '有' : '无'
  logComfyVideoPickDebug({ stage: 'generic-fallback', historyEntry, chosenUrl: generic, tried })
  return generic
}

/**
 * 视频节点底部输出条：只收集可播放的成片视频 URL（最多 2 条），避免中间预览图/无效链接在条里显示为黑块。
 */
export function pickComfyResultVideoStripUrls({
  providerConfig,
  historyEntry,
  allowFullEntryFallback = true,
  excludeFilenames,
  maxItems = 2,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  allowFullEntryFallback?: boolean
  excludeFilenames?: Iterable<string>
  maxItems?: number
}): string[] {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const exclude = new Set(
    Array.from(excludeFilenames ?? [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )
  const refs = collectComfyHistoryVisualRefsForResult(historyEntry, allowFullEntryFallback)
  const ranked = [...refs]
    .filter((r) => isComfyVideoFilename(r.filename) && mediaRefRank(r) < 3)
    .sort((a, b) => mediaRefRank(a) - mediaRefRank(b))
  const cap = Math.max(1, Math.min(4, maxItems))
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of ranked) {
    const key = mediaRefDedupeKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    const url = buildComfyViewUrl(requestBase, ref)
    const fn = readFilenameFromComfyViewUrl(url)
    if (fn && exclude.has(fn)) continue
    out.push(url)
    if (out.length >= cap) break
  }
  return out
}

/** 视频节点输出条：排除 PreviewImage/SaveImage 等产生的静态栅格图，避免与 `<video>` 预览组合出现「黑块」。 */
const COMFY_STATIC_RASTER_FILENAME_RE = /\.(png|jpe?g|webp|bmp|gif)$/i

/** 可当作成片在 `<video>` 中播放的扩展名 */
const COMFY_VIDEO_FILENAME_RE = /\.(mp4|webm|mov|mkv|avi|m4v|ogv)(\?|#|$)/i

function isComfyVideoFilename(filename: string): boolean {
  return COMFY_VIDEO_FILENAME_RE.test(String(filename || '').trim())
}

/**
 * 是否像可上传给 LoadAudio 的音频（排除视频节点主槽里常见的无声 mp4 预览）。
 * 勿把无后缀的 blob: 一律当音频，否则会误伤侧栏参考图 blob，导致「@ 有图但输入图为 0」。
 */
export function isLikelyAudioMediaUrl(url: string | null | undefined): boolean {
  const raw = String(url || '').trim()
  if (!raw) return false
  if (isComfyViewUrlLikelyVideo(raw)) return false
  const path = raw.split(/[?#]/)[0].toLowerCase()
  if (/\.(mp4|webm|mov|mkv|avi|m4v|ogv)(\?|#|$)/i.test(path)) return false
  const fn = readFilenameFromComfyViewUrl(raw)
  if (fn) {
    if (isComfyVideoFilename(fn)) return false
    if (/\.(wav|mp3|flac|m4a|aac|ogg|opus|weba)(\?|#|$)/i.test(fn)) return true
  }
  return /\.(wav|mp3|flac|m4a|aac|ogg|opus|weba)(\?|#|$)/i.test(path)
}

/** 判断 Comfy `/view?...` 或直链是否像可播放视频（用于视频节点优先选片，避免误用 PreviewAudio）。 */
export function isComfyViewUrlLikelyVideo(url: string | null | undefined): boolean {
  const raw = String(url || '').trim()
  if (!raw) return false
  const fn = readFilenameFromComfyViewUrl(raw)
  if (fn && isComfyVideoFilename(fn)) return true
  const path = raw.split(/[?#]/)[0] || ''
  return COMFY_VIDEO_FILENAME_RE.test(path)
}

/**
 * 从 ComfyUI history 提取本次任务全部视觉输出 view URL（多分镜/多 SaveImage 等），排除 input 档与可选文件名黑名单。
 */
export function pickComfyResultImageViewUrls({
  providerConfig,
  historyEntry,
  allowFullEntryFallback = true,
  excludeFilenames,
  /**
   * 为 true 时跳过 png/jpg/webp/bmp 文件名（保留 mp4/mov/webm/gif 等）。
   * 用于画布「视频节点」底部缩略条：Comfy 图生视频工作流常在 history 里混入大量中间预览图，用 video 标签无法解码静态图会显示全黑。
   */
  omitStaticRasterFilenamesForVideoStrip = false,
  /** 同一文件名在 temp/output 各出现一次时只保留一条（按 output 优先排序后的首次出现） */
  dedupeByFilenameBasename = false,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  allowFullEntryFallback?: boolean
  /** 与本次上传注入文件名一致时跳过，避免把参考图回显当输出 */
  excludeFilenames?: Iterable<string>
  omitStaticRasterFilenamesForVideoStrip?: boolean
  dedupeByFilenameBasename?: boolean
}): string[] {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const exclude = new Set(
    Array.from(excludeFilenames ?? [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )
  const refs = collectComfyHistoryVisualRefsForResult(historyEntry, allowFullEntryFallback)
  const ranked = [...refs]
    .filter((r) => mediaRefRank(r) < 3)
    .sort((a, b) => mediaRefRank(a) - mediaRefRank(b))
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of ranked) {
    const key = dedupeByFilenameBasename
      ? String(ref.filename || '')
          .replace(/\\/g, '/')
          .split('/')
          .pop()
          ?.toLowerCase() ?? ''
      : mediaRefDedupeKey(ref)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const refFn = String(ref.filename || '').trim()
    if (omitStaticRasterFilenamesForVideoStrip && COMFY_STATIC_RASTER_FILENAME_RE.test(refFn)) {
      continue
    }
    const url = buildComfyViewUrl(requestBase, ref)
    const fn = readFilenameFromComfyViewUrl(url)
    if (fn && exclude.has(fn)) continue
    out.push(url)
  }
  return out
}

/**
 * 从 ComfyUI history 结果提取音频 URL（若有）。
 * 同步版：不做体积探测；若 outputs 键为 UUID 导致多路 temp 并列，请用 {@link pickComfyResultAudioUrlAsync}。
 */
export function pickComfyResultAudioUrl({
  providerConfig,
  historyEntry,
  /** 与图片一致：跳过本次任务上传的参考音频名，避免回填成输入 */
  excludeFilenames,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  excludeFilenames?: Iterable<string>
}): string | null {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)

  const refs = collectTaggedAudioRefsFromHistoryEntry(historyEntry)
  const exclude = new Set(
    Array.from(excludeFilenames ?? [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )
  const filtered =
    exclude.size > 0
      ? refs.filter((r) => {
          const fn = String(r.filename || '').trim()
          return fn && !exclude.has(fn)
        })
      : refs
  const preferred = collectAudioSinkNodeIdsFromHistory(historyEntry)
  const dialogueMergeSaveIds = collectSaveAudioNodeIdsFedByDialogueInference(historyEntry)
  const first = pickBestAudioRef(filtered, preferred, dialogueMergeSaveIds)
  if (first) {
    const params = new URLSearchParams({
      filename: first.filename,
      subfolder: first.subfolder ?? '',
      type: first.type ?? 'output',
    })
    return `${requestBase}/view?${params.toString()}`
  }
  return null
}

/**
 * 异步解析音频 view URL：在优先级并列时用 HEAD/Range/主进程拉取探测 **最大文件**，避免 UUID 节点键下误选 BatchGenerateSpeaker 短试听。
 */
export async function pickComfyResultAudioUrlAsync({
  providerConfig,
  historyEntry,
  excludeFilenames,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  excludeFilenames?: Iterable<string>
}): Promise<string | null> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const refs = collectTaggedAudioRefsFromHistoryEntry(historyEntry)
  const exclude = new Set(
    Array.from(excludeFilenames ?? [])
      .map((s) => String(s || '').trim())
      .filter(Boolean),
  )
  const filtered =
    exclude.size > 0
      ? refs.filter((r) => {
          const fn = String(r.filename || '').trim()
          return fn && !exclude.has(fn)
        })
      : refs
  const preferred = collectAudioSinkNodeIdsFromHistory(historyEntry)
  return resolveBestComfyAudioViewUrl({
    providerConfig,
    requestBase,
    filteredRefs: filtered,
    preferred,
    historyEntry,
    rawRefCount: refs.length,
    debugStage: 'pick-async',
  })
}

/**
 * 当本次 prompt 命中缓存且 outputs 为空时，回退扫描全量历史取最近音频。
 */
export async function pickLatestComfyAudioUrlFromHistory({
  providerConfig,
  excludeFilenames,
}: {
  providerConfig: WorkflowProviderConfig
  excludeFilenames?: Iterable<string>
}): Promise<string | null> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const response = await fetch(`${requestBase}/history`, {
    headers: getAuthHeaders(providerConfig),
  })
  if (!response.ok) return null
  const payload = (await response.json()) as Record<string, unknown>
  const entries = Object.values(payload).filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  ) as Record<string, unknown>[]
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    const refs = collectTaggedAudioRefsFromHistoryEntry(entry)
    const exclude = new Set(
      Array.from(excludeFilenames ?? [])
        .map((s) => String(s || '').trim())
        .filter(Boolean),
    )
    const filtered =
      exclude.size > 0
        ? refs.filter((r) => {
            const fn = String(r.filename || '').trim()
            return fn && !exclude.has(fn)
          })
        : refs
    const preferred = collectAudioSinkNodeIdsFromHistory(entry)
    const url = await resolveBestComfyAudioViewUrl({
      providerConfig,
      requestBase,
      filteredRefs: filtered,
      preferred,
      historyEntry: entry,
      rawRefCount: refs.length,
      debugStage: 'pick-latest-fallback',
    })
    if (url) return url
  }
  return null
}

/**
 * 当本次 prompt 没有直接拿到图片/视频输出时，回退扫描全量历史取最近媒体。
 */
export async function pickLatestComfyMediaUrlFromHistory({
  providerConfig,
}: {
  providerConfig: WorkflowProviderConfig
}): Promise<string | null> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const response = await fetch(`${requestBase}/history`, {
    headers: getAuthHeaders(providerConfig),
  })
  if (!response.ok) return null
  const payload = (await response.json()) as Record<string, unknown>
  const entries = Object.values(payload).filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item),
  ) as Record<string, unknown>[]
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const refs: ComfyMediaRef[] = []
    const entry = entries[i]
    const outputs = entry.outputs as Record<string, unknown> | undefined
    if (outputs) {
      Object.values(outputs).forEach((nodeOutput) => collectMediaRefsFromAny(nodeOutput, refs))
    }
    collectMediaRefsFromAny(entry, refs)
    const first = pickFirstMediaRef(refs)
    if (!first) continue
    const params = new URLSearchParams({
      filename: first.filename,
      subfolder: first.subfolder ?? '',
      type: first.type ?? 'output',
    })
    return `${requestBase}/view?${params.toString()}`
  }
  return null
}

/**
 * 检测 ComfyUI 服务连通性。
 * 优先请求 `/system_stats`，失败后回退 `/queue`。
 */
export async function checkComfyHealth({
  providerConfig,
}: {
  providerConfig: WorkflowProviderConfig
}): Promise<ComfyHealthResult> {
  const baseUrl = effectiveCloudComfyBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  if (!baseUrl) {
    return { ok: false, message: '地址为空' }
  }
  const timeoutMs = Math.max(5, providerConfig.timeoutSec || 30) * 1000
  const tryPaths = ['/system_stats', '/queue']
  for (const path of tryPaths) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${requestBase}${path}`, {
        method: 'GET',
        headers: getAuthHeaders(providerConfig),
        signal: controller.signal,
      })
      window.clearTimeout(timer)
      if (response.ok) {
        return { ok: true, message: `连接成功（${path}）` }
      }
    } catch (error) {
      window.clearTimeout(timer)
      const msg = String((error as Error)?.message || error || '网络或跨域错误')
      const devProxyHint =
        usesComfySameOriginProxy() && String(requestBase).includes('__comfy_dev_proxy__')
          ? ' 若页面提示 [vite] server connection lost，多为开发服务器在代理该请求时异常退出，请查看运行 npm run dev 的终端并重启 dev。'
          : ''
      if (path === tryPaths[tryPaths.length - 1]) {
        return {
          ok: false,
          message: `连接失败：${msg}${devProxyHint}`,
        }
      }
    }
  }
  const devTail =
    usesComfySameOriginProxy() && String(requestBase).includes('__comfy_dev_proxy__')
      ? '（经同源 Comfy 反代；直连 https 云端会触发 CORS。若反复失败请查看终端/桌面日志。）'
      : ''
  return { ok: false, message: `连接失败，请检查地址、网络或鉴权信息${devTail}` }
}
