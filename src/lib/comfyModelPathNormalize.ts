import type { WorkflowProviderConfig } from '../types'
import { getAuthHeaders, normalizeBaseUrl, resolveRequestBase } from './comfyClient'

/** 工作流模板常用名 → 本机 Comfy 下拉列表中的路径（Windows 下多为 `Wan\\xxx`） */
const STATIC_MODEL_NAME_ALIASES: Record<string, string> = {
  'umt5_xxl_fp16.safetensors': 'Wan\\umt5_xxl_fp16.safetensors',
  'wan_2.1_vae.safetensors': 'Wan\\wan_2.1_vae.safetensors',
}

type LoaderField = 'clip_name' | 'vae_name' | 'unet_name'

const LOADER_CLASS_FIELDS: Array<{ classMatch: RegExp; field: LoaderField }> = [
  { classMatch: /CLIPLoader/i, field: 'clip_name' },
  { classMatch: /VAELoader/i, field: 'vae_name' },
  { classMatch: /UNETLoader/i, field: 'unet_name' },
]

let objectInfoCache: { baseUrl: string; data: Record<string, unknown> } | null = null

/**
 * 拉取 Comfy `object_info`（带简单内存缓存，同 baseUrl 复用）。
 */
async function fetchComfyObjectInfo(
  providerConfig: WorkflowProviderConfig,
): Promise<Record<string, unknown>> {
  const baseUrl = normalizeBaseUrl(providerConfig.baseUrl)
  if (objectInfoCache?.baseUrl === baseUrl) {
    return objectInfoCache.data
  }
  const requestBase = resolveRequestBase(baseUrl)
  const headers = getAuthHeaders(providerConfig)
  const candidates = [`${requestBase}/object_info`, `${requestBase}/api/object_info`]
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    if (['127.0.0.1', 'localhost'].includes(host) && url.port === '8188') {
      candidates.unshift('/__comfy_local__/object_info', '/__comfy_local__/api/object_info')
    }
  } catch {
    /* ignore */
  }
  for (const path of candidates) {
    try {
      const resp = await fetch(path, { headers })
      if (!resp.ok) continue
      const json = (await resp.json()) as Record<string, unknown>
      if (json && typeof json === 'object') {
        objectInfoCache = { baseUrl, data: json }
        return json
      }
    } catch {
      continue
    }
  }
  objectInfoCache = { baseUrl, data: {} }
  return {}
}

/**
 * 从 object_info 读取某节点某字段的下拉枚举列表。
 */
function getEnumChoicesFromObjectInfo(
  objectInfo: Record<string, unknown>,
  classType: string,
  inputKey: string,
): string[] {
  const classInfo = objectInfo[classType]
  if (!classInfo || typeof classInfo !== 'object' || Array.isArray(classInfo)) return []
  const input = (classInfo as Record<string, unknown>).input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const required = (input as Record<string, unknown>).required
  if (!required || typeof required !== 'object' || Array.isArray(required)) return []
  const spec = (required as Record<string, unknown>)[inputKey]
  if (!Array.isArray(spec)) return []
  const choices = spec[0]
  if (!Array.isArray(choices)) return []
  return choices.map((c) => String(c))
}

function basenameOfModelPath(name: string): string {
  return String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.toLowerCase() ?? ''
}

/**
 * 在 Comfy 枚举列表中解析 UNET：优先精确/别名/ basename，再按 high/low 关键词模糊匹配 Wan i2v。
 */
function resolveModelNameInChoices(requested: string, choices: string[]): string | null {
  const req = String(requested || '').trim()
  if (!req || !choices.length) return null
  if (choices.includes(req)) return req
  const alias = STATIC_MODEL_NAME_ALIASES[req]
  if (alias && choices.includes(alias)) return alias
  const reqBase = basenameOfModelPath(req)
  const byBase = choices.find((c) => basenameOfModelPath(c) === reqBase)
  if (byBase) return byBase
  const lower = req.toLowerCase()
  const wanChoices = choices.filter((c) => /wan/i.test(c))
  if (!wanChoices.length) return null
  const i2vPool = wanChoices.filter((c) => /i2v|2\.2|2_2|14b/i.test(c))
  const pool = i2vPool.length ? i2vPool : wanChoices
  if (/high/i.test(lower)) {
    return (
      pool.find((c) => /high/i.test(c) && /light|noise|remix/i.test(c)) ??
      pool.find((c) => /high/i.test(c)) ??
      null
    )
  }
  if (/low/i.test(lower)) {
    return (
      pool.find((c) => /low/i.test(c) && /light|noise|remix/i.test(c)) ??
      pool.find((c) => /low/i.test(c)) ??
      null
    )
  }
  return null
}

/**
 * 提交 Comfy 前修正 CLIP/VAE/UNET 加载器的模型路径，避免「Value not in list」导致 0.x 秒即失败。
 */
export async function normalizeComfyLoaderModelPathsInPrompt(
  prompt: Record<string, unknown>,
  providerConfig: WorkflowProviderConfig,
): Promise<Record<string, unknown>> {
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const objectInfo = await fetchComfyObjectInfo(providerConfig)
  const unresolved: string[] = []

  for (const node of Object.values(cloned)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const rec = node as Record<string, unknown>
    const classType = String(rec.class_type || '').trim()
    if (!classType) continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inputRecord = inputs as Record<string, unknown>

    for (const { classMatch, field } of LOADER_CLASS_FIELDS) {
      if (!classMatch.test(classType)) continue
      const raw = inputRecord[field]
      if (typeof raw !== 'string' || !raw.trim()) continue
      const requested = raw.trim()
      let resolved = STATIC_MODEL_NAME_ALIASES[requested] ?? requested
      const choices = getEnumChoicesFromObjectInfo(objectInfo, classType, field)
      if (choices.length) {
        if (!choices.includes(resolved)) {
          const picked = resolveModelNameInChoices(requested, choices)
          if (picked) resolved = picked
        }
        if (!choices.includes(resolved)) {
          unresolved.push(`${classType} ${field}=${requested}`)
          continue
        }
      } else if (STATIC_MODEL_NAME_ALIASES[requested]) {
        resolved = STATIC_MODEL_NAME_ALIASES[requested]
      }
      if (resolved !== requested) {
        inputRecord[field] = resolved
      }
    }
  }

  if (unresolved.length) {
    const wanUnets = getEnumChoicesFromObjectInfo(objectInfo, 'UNETLoader', 'unet_name').filter((c) =>
      /wan/i.test(c),
    )
    const hint =
      wanUnets.length > 0
        ? ` 本机已有 Wan 类 UNET 示例：${wanUnets.slice(0, 5).join('、')}${wanUnets.length > 5 ? '…' : ''}`
        : ' 请将 Wan2.2 Remix 高/低噪声 UNET 放入 Comfy 的 models/unet（或 diffusion_models）并刷新列表。'
    throw new Error(
      `Comfy 模型文件未匹配（${unresolved.join('；')}）。${hint}`,
    )
  }

  return cloned
}
