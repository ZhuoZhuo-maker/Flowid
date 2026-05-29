import { normalizeOpenAICompatibleBaseUrl } from './openaiCompat'

/** 异步任务成功状态（与无限画布 main.py 对齐） */
const TASK_SUCCESS = new Set([
  'SUCCESS',
  'SUCCEED',
  'SUCCEEDED',
  'COMPLETED',
  'COMPLETE',
  'DONE',
  'FINISHED',
  'OK',
  'READY',
])

/** 异步任务失败状态 */
const TASK_FAILURE = new Set([
  'FAILURE',
  'FAILED',
  'FAIL',
  'ERROR',
  'ERRORED',
  'CANCELED',
  'CANCELLED',
  'TIMEOUT',
  'TIMEDOUT',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
])

/**
 * 是否为 ModelScope 等需 `X-ModelScope-Async-Mode` 的推理根地址。
 * @param baseUrl 用户填写的 API 根地址
 */
export function isModelScopeInferenceBase(baseUrl: string): boolean {
  return /modelscope\.cn/i.test(String(baseUrl || ''))
}

/**
 * 生图提交请求头：ModelScope 异步模式需额外请求头。
 */
export function cloudImageSubmitHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (isModelScopeInferenceBase(baseUrl)) {
    headers['X-ModelScope-Async-Mode'] = 'true'
  }
  return headers
}

/**
 * 任务轮询请求头。
 */
export function cloudImagePollHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  }
  if (isModelScopeInferenceBase(baseUrl)) {
    headers['X-ModelScope-Task-Type'] = 'image_generation'
  }
  return headers
}

/**
 * 从提交/轮询响应中读取图片 URL（含 ModelScope `output_images`）。
 */
export function readCloudImageUrlFromPayload(payload: unknown): string {
  const p = payload as Record<string, unknown> | null | undefined
  if (!p) return ''
  const outputImages = p.output_images
  const candidates: unknown[] = [
    ...(Array.isArray(outputImages) ? outputImages : []),
    (p.data as any)?.[0]?.url,
    (p.data as any)?.[0]?.b64_json,
    p.url,
    (p.output as any)?.url,
    (p.output as any)?.image_url,
    (p.result as any)?.url,
  ]
  for (const item of candidates) {
    const v = String(item || '').trim()
    if (v) return v.startsWith('data:') ? v : v
  }
  return ''
}

/**
 * 从响应中读取异步 task_id。
 */
export function readCloudImageTaskId(payload: unknown): string {
  const p = payload as Record<string, unknown> | null | undefined
  if (!p) return ''
  const candidates = [
    p.task_id,
    p.taskId,
    p.id,
    (p.data as any)?.task_id,
    (p.output as any)?.task_id,
  ]
  for (const item of candidates) {
    const v = String(item || '').trim()
    if (v) return v
  }
  return ''
}

function readTaskStatus(payload: unknown): string {
  const p = payload as Record<string, unknown> | null | undefined
  if (!p) return ''
  const nested = p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : null
  return String(
    p.task_status || p.status || nested?.status || nested?.task_status || '',
  )
    .trim()
    .toUpperCase()
}

/**
 * 构建生图任务轮询 URL 列表（参考无限画布 `wait_for_image_task`）。
 */
export function cloudImageTaskPollUrls(baseUrl: string, taskId: string): string[] {
  const root = normalizeOpenAICompatibleBaseUrl(baseUrl)
  const enc = encodeURIComponent(taskId)
  if (isModelScopeInferenceBase(root)) {
    return [`${root}/v1/tasks/${enc}`]
  }
  if (root.endsWith('/v1')) {
    return [`${root}/images/tasks/${enc}`, `${root}/tasks/${enc}`]
  }
  return [`${root}/v1/images/tasks/${enc}`, `${root}/v1/tasks/${enc}`, `${root}/images/tasks/${enc}`]
}

export type PollCloudImageTaskOptions = {
  baseUrl: string
  apiKey: string
  taskId: string
  /** 默认 300 秒 */
  timeoutMs?: number
  /** 默认 2000ms */
  intervalMs?: number
  onProgress?: (label: string) => void
}

/**
 * 轮询异步生图任务直至成功或失败（ModelScope / OpenAI 兼容异步）。
 */
export async function pollCloudImageTask(opts: PollCloudImageTaskOptions): Promise<string> {
  const { baseUrl, apiKey, taskId } = opts
  const timeoutMs = opts.timeoutMs ?? 300_000
  const intervalMs = opts.intervalMs ?? 2000
  const pollUrls = cloudImageTaskPollUrls(baseUrl, taskId)
  const headers = cloudImagePollHeaders(apiKey, baseUrl)
  const deadline = Date.now() + timeoutMs
  let lastStatus = ''

  while (Date.now() < deadline) {
    opts.onProgress?.(lastStatus ? `云端生图 ${lastStatus}…` : '云端生图排队中…')
    for (const pollUrl of pollUrls) {
      try {
        const res = await fetch(pollUrl, { method: 'GET', headers })
        if (!res.ok) continue
        const json = (await res.json().catch(() => ({}))) as unknown
        const imageUrl = readCloudImageUrlFromPayload(json)
        if (imageUrl) return imageUrl
        const status = readTaskStatus(json)
        if (status) lastStatus = status
        if (TASK_SUCCESS.has(status)) {
          const again = readCloudImageUrlFromPayload(json)
          if (again) return again
          throw new Error(`${pollUrl} -> 任务已成功但未返回图片 URL`)
        }
        if (TASK_FAILURE.has(status)) {
          const p = json as Record<string, unknown>
          const msg = String(
            p.error_info || p.message || p.detail || (p.error as any)?.message || '任务失败',
          )
          throw new Error(`${pollUrl} -> ${msg}`)
        }
      } catch (e) {
        if (e instanceof Error && TASK_FAILURE.has(readTaskStatus({}))) throw e
        if (e instanceof Error && /任务失败|->/.test(e.message)) throw e
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`生图任务超时（taskId=${taskId}，已等待 ${Math.round(timeoutMs / 1000)} 秒）`)
}
