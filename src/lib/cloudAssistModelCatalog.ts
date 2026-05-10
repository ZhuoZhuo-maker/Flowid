import { loadLicenseServerConfig } from './licenseAccess'
import { normalizeOpenAICompatibleBaseUrl } from './openaiCompat'

export const CLOUD_ASSIST_KINDS = ['text', 'image', 'video', 'audio', 'music'] as const
export type CloudAssistKind = (typeof CLOUD_ASSIST_KINDS)[number]

/** 用于 UI 遍历（与后台 `CLOUD_ASSIST_KINDS` 顺序一致） */
export const CLOUD_ASSIST_KIND_LIST: CloudAssistKind[] = [...CLOUD_ASSIST_KINDS]

export const CLOUD_ASSIST_KIND_LABELS: Record<CloudAssistKind, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  music: '音乐',
}

const LS_ASSIST_KEYS = 'flowid.cloud.assist.apiKeys.v1'

/** 画布节点 kind → 后台「云端模型配置」分类（脚本走文本） */
export function studioNodeKindToAssistKind(nodeKind: string): CloudAssistKind | null {
  if (nodeKind === 'script') return 'text'
  return (CLOUD_ASSIST_KINDS as readonly string[]).includes(nodeKind) ? (nodeKind as CloudAssistKind) : null
}

export type CloudAssistEndpoint = { id: string; baseUrl: string; models: string[] }

export type CloudAssistCatalog = { kinds: Record<CloudAssistKind, CloudAssistEndpoint[]> }

const emptyKinds = (): Record<CloudAssistKind, CloudAssistEndpoint[]> => ({
  text: [],
  image: [],
  video: [],
  audio: [],
  music: [],
})

export function emptyCloudAssistCatalog(): CloudAssistCatalog {
  return { kinds: emptyKinds() }
}

function normalizeAuthBase(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
}

/** 下拉选项值：与自助预设 id 不冲突 */
const ASSIST_PICK_PREFIX = 'flowid-assist:'

export function encodeCloudAssistModelPick(endpointId: string, model: string): string {
  return `${ASSIST_PICK_PREFIX}${encodeURIComponent(endpointId)}\x1f${encodeURIComponent(model)}`
}

export function tryDecodeCloudAssistModelPick(
  value: string,
): { endpointId: string; model: string } | null {
  const v = String(value || '')
  if (!v.startsWith(ASSIST_PICK_PREFIX)) return null
  const rest = v.slice(ASSIST_PICK_PREFIX.length)
  const i = rest.indexOf('\x1f')
  if (i < 0) return null
  try {
    return {
      endpointId: decodeURIComponent(rest.slice(0, i)),
      model: decodeURIComponent(rest.slice(i + 1)),
    }
  } catch {
    return null
  }
}

/** 各类型辅助线路 API Key（仅本地） */
export function readAssistApiKeys(): Record<CloudAssistKind, string> {
  const out = { text: '', image: '', video: '', audio: '', music: '' } as Record<CloudAssistKind, string>
  try {
    const raw = window.localStorage.getItem(LS_ASSIST_KEYS)
    if (!raw) return out
    const j = JSON.parse(raw) as Record<string, unknown>
    if (!j || typeof j !== 'object') return out
    for (const k of CLOUD_ASSIST_KINDS) {
      out[k] = String((j as any)[k] || '').trim()
    }
    return out
  } catch {
    return out
  }
}

export function writeAssistApiKeys(next: Partial<Record<CloudAssistKind, string>>): void {
  const cur = readAssistApiKeys()
  for (const k of CLOUD_ASSIST_KINDS) {
    if (Object.prototype.hasOwnProperty.call(next, k)) {
      cur[k] = String((next as any)[k] ?? '').trim()
    }
  }
  window.localStorage.setItem(LS_ASSIST_KEYS, JSON.stringify(cur))
  window.dispatchEvent(new CustomEvent('flowid:cloud-assist-keys-changed'))
}

export function getAssistApiKey(kind: CloudAssistKind): string {
  return readAssistApiKeys()[kind] || ''
}

export async function fetchCloudAssistModelCatalog(): Promise<CloudAssistCatalog> {
  const base = normalizeAuthBase(String(loadLicenseServerConfig().baseUrl || ''))
  if (!base) return { kinds: emptyKinds() }
  const url = `${base}/cloud-assist-model-catalog`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { kinds?: Record<string, unknown> }
  const kinds = emptyKinds()
  const src = json?.kinds && typeof json.kinds === 'object' ? json.kinds : {}
  for (const k of CLOUD_ASSIST_KINDS) {
    const arr = Array.isArray((src as any)[k]) ? ((src as any)[k] as unknown[]) : []
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue
      const id = String((row as any).id || '').trim()
      const baseUrl = String((row as any).baseUrl || '').trim()
      const models: string[] = []
      const rawModels = Array.isArray((row as any).models) ? ((row as any).models as unknown[]) : []
      for (const m of rawModels) {
        const t = String(m || '').trim()
        if (t && !models.includes(t)) models.push(t)
      }
      if (id && baseUrl && models.length) kinds[k].push({ id, baseUrl, models })
    }
  }
  return { kinds }
}

/** 使用后台目录中该类型的第一个线路根地址 + 用户本地 Key 探测 OpenAI 兼容 /v1/models */
export async function testAssistConnectionForKind(kind: CloudAssistKind): Promise<{ ok: boolean; message: string }> {
  const apiKey = getAssistApiKey(kind)
  if (!apiKey) return { ok: false, message: '请先填写 API Key' }
  let catalog: CloudAssistCatalog
  try {
    catalog = await fetchCloudAssistModelCatalog()
  } catch (e) {
    return { ok: false, message: `拉取目录失败：${String((e as Error)?.message || e)}` }
  }
  const ep = (catalog.kinds[kind] || [])[0]
  if (!ep) return { ok: false, message: '后台尚未配置该类型的辅助线路（Auth 控制台 → 云端模型配置）' }
  const root = normalizeOpenAICompatibleBaseUrl(ep.baseUrl)
  if (!root) return { ok: false, message: '线路地址无效' }
  const url = `${root}/v1/models`
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return { ok: true, message: '连接成功：可访问 /v1/models' }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message || e || '请求失败') }
  }
}

export function findAssistEndpoint(kind: CloudAssistKind, endpointId: string, catalog: CloudAssistCatalog) {
  const id = String(endpointId || '').trim()
  return (catalog.kinds[kind] || []).find((x) => x.id === id) ?? null
}
