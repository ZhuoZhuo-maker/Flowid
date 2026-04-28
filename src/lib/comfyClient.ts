import type { NodeRunProgress, WorkflowProviderConfig } from '../types'

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
  const originalBlob = await imageResponse.blob()
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
  try {
    const response = await fetchWithTimeout(
      mediaUrl,
      {
        method: 'GET',
        headers: getAuthHeaders(providerConfig),
      },
      Math.max(2000, timeoutMs),
    )
    if (!response.ok) return null
    return mediaUrl
  } catch {
    return null
  }
}

/**
 * 将 URL 统一处理为无尾斜杠格式。
 */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * 本地 ComfyUI 在浏览器直连时可能触发 CORS/PNA，开发态走 Vite 同源代理更稳定。
 * 生产构建无 Vite 代理时，必须使用真实 baseUrl（由 Comfy 开启 CORS 或同源反代）。
 */
function resolveRequestBase(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!import.meta.env.DEV) {
    return normalized
  }
  try {
    const url = new URL(normalized)
    const isLocalHost =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    const isDefaultComfyPort = url.port === '8188'
    if (isLocalHost && isDefaultComfyPort) {
      return '/__comfy_local__'
    }
  } catch {
    // fallback to raw baseUrl
  }
  return normalized
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

function getAuthHeaders(config: WorkflowProviderConfig): HeadersInit {
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

function pickFirstAudioRef(refs: ComfyAudioRef[]): ComfyAudioRef | null {
  const hit = refs.find((item) => {
    const filename = item.filename.toLowerCase()
    return Array.from(AUDIO_FILE_EXTENSIONS).some((ext) => filename.endsWith(ext))
  })
  return hit ?? null
}

function collectMediaRefsFromAny(value: unknown, refs: ComfyMediaRef[]) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaRefsFromAny(item, refs))
    return
  }
  const record = value as Record<string, unknown>
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

function pickFirstMediaRef(refs: ComfyMediaRef[]): ComfyMediaRef | null {
  if (!refs.length) return null
  const normalize = (value: string | undefined) => (value || '').trim().toLowerCase()
  const mediaRank = (item: ComfyMediaRef): number => {
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
  return [...refs].sort((a, b) => mediaRank(a) - mediaRank(b))[0] ?? refs[0]
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
export type ComfyHistoryResultExpectation = 'visual' | 'audio' | 'general'
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
 * @param expectation `visual`：必须已有图/视频产物（**不能**仅凭 `completed` 或仅有尺寸 text）；`audio`：优先音频；`general`：文本等，但排除「仅尺寸类 text」的假完成。
 */
function isHistoryEntryReady(
  entry: Record<string, unknown>,
  expectation: ComfyHistoryResultExpectation,
): boolean {
  const outObj = normalizeHistoryOutputs(entry)
  const ui = entry.ui
  const uiObj = ui && typeof ui === 'object' && !Array.isArray(ui) ? (ui as Record<string, unknown>) : null

  const status = entry.status
  const completed =
    status && typeof status === 'object' && !Array.isArray(status)
      ? (status as Record<string, unknown>).completed === true
      : false

  if (expectation === 'visual') {
    if (outObj && Object.keys(outObj).length > 0 && historyOutputsContainRasterVisual(outObj)) {
      return true
    }
    if (uiObj && historyUiContainRasterVisual(uiObj)) return true
    return false
  }

  if (expectation === 'audio') {
    if (outObj && Object.keys(outObj).length > 0 && historyOutputsHaveAudioSignals(outObj)) return true
    if (uiObj && historyUiHasAudioSignals(uiObj)) return true
    if (outObj && Object.keys(outObj).length > 0 && historyOutputsContainRenderableMedia(outObj)) {
      return true
    }
    if (uiObj && historyUiContainRenderableMedia(uiObj)) return true
    if (completed && outObj && Object.keys(outObj).length > 0) {
      return !historyOutputsAreOnlyDimensionLikeText(outObj)
    }
    return false
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
  const body = JSON.stringify({ prompt })
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
 * 根据队列与历史就绪情况映射 UI 进度（近似值，非 Comfy 内部步数）。
 */
/**
 * 轮询队列/历史时遇到不可恢复错误，抛出后由上层弹窗提示，避免无限请求。
 */
export class ComfyPollFatalError extends Error {
  override readonly name = 'ComfyPollFatalError'
}

/** 鉴权类 HTTP 状态：继续轮询无意义 */
function isComfyUnauthorizedStatus(status: number): boolean {
  return status === 401 || status === 403
}

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
        /**
         * 图/视频：严格 `isHistoryEntryReady(visual)` 与 `pick` 的边界情况可能不一致；
         * 若已能从 outputs/ui 解析出 view URL（且不扫整条 prompt），即视为可结束轮询。
         */
        if (
          resultExpectation === 'visual' &&
          scopedEntry &&
          !isHistoryEntryReady(scopedEntry, 'visual') &&
          pickComfyResultImageUrl({
            providerConfig,
            historyEntry: scopedEntry,
            allowFullEntryFallback: false,
          })
        ) {
          emitProgress({ percent: 88, label: '任务已完成，正在获取输出…' })
          return scopedEntry
        }
        if (scopedEntry) {
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
          resultExpectation === 'visual' &&
          fullEntry &&
          !isHistoryEntryReady(fullEntry, 'visual') &&
          pickComfyResultImageUrl({
            providerConfig,
            historyEntry: fullEntry,
            allowFullEntryFallback: false,
          })
        ) {
          emitProgress({ percent: 88, label: '任务已完成，正在获取输出…' })
          return fullEntry
        }
        if (fullEntry) {
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
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
  allowFullEntryFallback?: boolean
}): string | null {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)
  const pushImageLikeRefs = (nodeOutput: Record<string, unknown>, target: ComfyMediaRef[]) => {
    const pushRef = (item: ComfyImageRef) => {
      const filename = String(item.filename ?? item.name ?? '').trim()
      if (!filename) return
      target.push({
        filename,
        subfolder: item.subfolder,
        type: item.type,
      })
    }
    const images = nodeOutput.images as ComfyImageRef[] | undefined
    if (images?.length) {
      images.forEach((item) => pushRef(item))
    }
    /** 部分工作流以 `gifs` 输出帧序列（结构与 `images` 一致） */
    const gifs = nodeOutput.gifs as ComfyImageRef[] | undefined
    if (gifs?.length) {
      gifs.forEach((item) => pushRef(item))
    }
    /** 视频节点/工作流常见 `videos` 数组，结构与 `images` 一致 */
    const videos = nodeOutput.videos as ComfyImageRef[] | undefined
    if (videos?.length) {
      videos.forEach((item) => pushRef(item))
    }
    collectMediaRefsFromAny(nodeOutput, target)
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
  let first = pickFirstMediaRef(refs)
  if (first) {
    const params = new URLSearchParams({
      filename: first.filename,
      subfolder: first.subfolder ?? '',
      type: first.type ?? 'output',
    })
    return `${requestBase}/view?${params.toString()}`
  }

  const ui = historyEntry.ui as Record<string, unknown> | undefined
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    const uiRefs: ComfyMediaRef[] = []
    collectMediaRefsFromAny(ui, uiRefs)
    first = pickFirstMediaRef(uiRefs)
    if (first) {
      const params = new URLSearchParams({
        filename: first.filename,
        subfolder: first.subfolder ?? '',
        type: first.type ?? 'output',
      })
      return `${requestBase}/view?${params.toString()}`
    }
  }

  if (!allowFullEntryFallback) {
    return null
  }
  // 兜底：部分工作流不会把媒体放在 outputs/ui，直接扫描整个 history 条目（可能误扫 prompt 内字符串，仅在上层允许时启用）。
  const fallbackRefs: ComfyMediaRef[] = []
  collectMediaRefsFromAny(historyEntry, fallbackRefs)
  first = pickFirstMediaRef(fallbackRefs)
  if (!first) return null
  const params = new URLSearchParams({
    filename: first.filename,
    subfolder: first.subfolder ?? '',
    type: first.type ?? 'output',
  })
  return `${requestBase}/view?${params.toString()}`
}

/**
 * 从 ComfyUI history 结果提取音频 URL（若有）。
 */
export function pickComfyResultAudioUrl({
  providerConfig,
  historyEntry,
}: {
  providerConfig: WorkflowProviderConfig
  historyEntry: Record<string, unknown>
}): string | null {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  const requestBase = resolveRequestBase(baseUrl)

  const refs: ComfyAudioRef[] = []
  const outputs = normalizeHistoryOutputs(historyEntry)
  if (outputs) {
    Object.values(outputs).forEach((nodeOutput) => collectAudioFileRefsFromAny(nodeOutput, refs))
  }
  // 一些自定义节点不会把结果放在 outputs，直接回退扫描整个 history 条目。
  collectAudioFileRefsFromAny(historyEntry, refs)
  const first = pickFirstAudioRef(refs)
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
 * 当本次 prompt 命中缓存且 outputs 为空时，回退扫描全量历史取最近音频。
 */
export async function pickLatestComfyAudioUrlFromHistory({
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
    const refs: ComfyAudioRef[] = []
    const entry = entries[i]
    const outputs = entry.outputs as Record<string, unknown> | undefined
    if (outputs) {
      Object.values(outputs).forEach((nodeOutput) =>
        collectAudioFileRefsFromAny(nodeOutput, refs),
      )
    }
    collectAudioFileRefsFromAny(entry, refs)
    const first = pickFirstAudioRef(refs)
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
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
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
      if (path === tryPaths[tryPaths.length - 1]) {
        return {
          ok: false,
          message: `连接失败：${(error as Error)?.message || '网络或跨域错误'}`,
        }
      }
    }
  }
  return { ok: false, message: '连接失败，请检查地址、网络或鉴权信息' }
}
