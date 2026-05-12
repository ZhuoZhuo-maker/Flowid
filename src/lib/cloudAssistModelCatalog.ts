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
const LS_ASSIST_VERIFIED = 'flowid.cloud.assist.lineVerified.v1'

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

function defaultAssistLineVerified(): Record<CloudAssistKind, boolean> {
  return { text: false, image: false, video: false, audio: false, music: false }
}

/**
 * 辅助线路是否已通过设置页「测试连接」。
 * 仅在为 true 且本地已填 Key 时，节点「模型」下拉里才展示 Auth 云端目录中的模型。
 */
export function readAssistLineVerified(): Record<CloudAssistKind, boolean> {
  try {
    const raw = window.localStorage.getItem(LS_ASSIST_VERIFIED)
    const d = defaultAssistLineVerified()
    if (!raw) return d
    const j = JSON.parse(raw) as Partial<Record<CloudAssistKind, boolean>>
    for (const kk of CLOUD_ASSIST_KINDS) {
      d[kk] = Boolean((j as any)[kk])
    }
    return d
  } catch {
    return defaultAssistLineVerified()
  }
}

export function writeAssistLineVerified(patch: Partial<Record<CloudAssistKind, boolean>>): void {
  const cur = readAssistLineVerified()
  for (const kk of CLOUD_ASSIST_KINDS) {
    if (Object.prototype.hasOwnProperty.call(patch, kk)) {
      cur[kk] = Boolean((patch as any)[kk])
    }
  }
  try {
    window.localStorage.setItem(LS_ASSIST_VERIFIED, JSON.stringify(cur))
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent('flowid:assist-line-verified-changed'))
  } catch {
    // ignore
  }
}

export function invalidateAssistLineVerifiedForKinds(kinds: CloudAssistKind[]): void {
  const uniq = [...new Set(kinds.filter(Boolean))] as CloudAssistKind[]
  if (!uniq.length) return
  const patch: Partial<Record<CloudAssistKind, boolean>> = {}
  for (const k of uniq) patch[k] = false
  writeAssistLineVerified(patch)
}

export type CloudAssistKeysChangedDetail = {
  clearedAssistKinds: CloudAssistKind[]
  /** Key 相对上次写入有变化，需重新测试通过后才展示云端模型 */
  keyChangedAssistKinds: CloudAssistKind[]
}

export function writeAssistApiKeys(next: Partial<Record<CloudAssistKind, string>>): void {
  const cur = readAssistApiKeys()
  const clearedAssistKinds: CloudAssistKind[] = []
  const keyChangedAssistKinds: CloudAssistKind[] = []
  for (const k of CLOUD_ASSIST_KINDS) {
    if (Object.prototype.hasOwnProperty.call(next, k)) {
      const prev = String(cur[k] || '').trim()
      const nw = String((next as any)[k] ?? '').trim()
      cur[k] = nw
      if (prev && !nw) clearedAssistKinds.push(k)
      if (prev !== nw) keyChangedAssistKinds.push(k)
    }
  }
  window.localStorage.setItem(LS_ASSIST_KEYS, JSON.stringify(cur))
  invalidateAssistLineVerifiedForKinds(keyChangedAssistKinds)
  window.dispatchEvent(
    new CustomEvent('flowid:cloud-assist-keys-changed', {
      detail: { clearedAssistKinds, keyChangedAssistKinds } satisfies CloudAssistKeysChangedDetail,
    }),
  )
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
