export type CloudProviderId = 'doubao' | 'gemini' | 'openai'

export type CloudSelfPreset = {
  id: string
  /** 匹配的节点类型（为空表示可用于任意节点） */
  nodeKind?: string
  providerId: CloudProviderId
  baseUrl: string
  apiKey: string
  model: string
  createdAtMs: number
  updatedAtMs: number
}

const KEY_LIST = 'flowid.cloud.self.presets.v1'
const KEY_ACTIVE = 'flowid.cloud.self.activePresetId.v1'
const MAX_ITEMS = 50

function safeParseList(raw: string | null): CloudSelfPreset[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((p) => ({
        id: String((p as any)?.id || ''),
        nodeKind: String((p as any)?.nodeKind || ''),
        providerId: String((p as any)?.providerId || '') as CloudProviderId,
        baseUrl: String((p as any)?.baseUrl || ''),
        apiKey: String((p as any)?.apiKey || ''),
        model: String((p as any)?.model || ''),
        createdAtMs: Number((p as any)?.createdAtMs || 0),
        updatedAtMs: Number((p as any)?.updatedAtMs || 0),
      }))
      .filter((p) => p.id && p.providerId && (p.baseUrl || p.apiKey || p.model))
  } catch {
    return []
  }
}

export function loadCloudSelfPresets(): CloudSelfPreset[] {
  try {
    const list = safeParseList(window.localStorage.getItem(KEY_LIST))
    return list.sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0)).slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

export function saveCloudSelfPresets(next: CloudSelfPreset[]) {
  try {
    window.localStorage.setItem(KEY_LIST, JSON.stringify((next || []).slice(0, MAX_ITEMS)))
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent('flowid:cloud-self-presets-changed'))
  } catch {
    // ignore
  }
}

export function upsertCloudSelfPreset(
  patch: Omit<CloudSelfPreset, 'createdAtMs' | 'updatedAtMs'> & { createdAtMs?: number },
) {
  const now = Date.now()
  const list = loadCloudSelfPresets()
  const idx = list.findIndex((x) => x.id === patch.id)
  const base: CloudSelfPreset =
    idx >= 0
      ? list[idx]
      : {
          id: patch.id,
          nodeKind: patch.nodeKind || '',
          providerId: patch.providerId,
          baseUrl: '',
          apiKey: '',
          model: '',
          createdAtMs: patch.createdAtMs || now,
          updatedAtMs: now,
        }
  const merged: CloudSelfPreset = {
    ...base,
    nodeKind: String(patch.nodeKind || ''),
    providerId: patch.providerId,
    baseUrl: String(patch.baseUrl || ''),
    apiKey: String(patch.apiKey || ''),
    model: String(patch.model || ''),
    updatedAtMs: now,
  }
  const next = idx >= 0 ? list.map((x, i) => (i === idx ? merged : x)) : [merged, ...list]
  saveCloudSelfPresets(next)
  return merged
}

export function removeCloudSelfPreset(id: string) {
  const list = loadCloudSelfPresets()
  const next = list.filter((x) => x.id !== id)
  saveCloudSelfPresets(next)
  const active = loadActiveCloudSelfPresetId()
  if (active && active === id) {
    setActiveCloudSelfPresetId('')
  }
  return next
}

export function loadActiveCloudSelfPresetId(): string {
  try {
    return String(window.localStorage.getItem(KEY_ACTIVE) || '')
  } catch {
    return ''
  }
}

export function setActiveCloudSelfPresetId(id: string) {
  try {
    if (!id) window.localStorage.removeItem(KEY_ACTIVE)
    else window.localStorage.setItem(KEY_ACTIVE, String(id))
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent('flowid:cloud-self-presets-changed'))
  } catch {
    // ignore
  }
}

export function getActiveCloudSelfPreset(): CloudSelfPreset | null {
  const list = loadCloudSelfPresets()
  const activeId = loadActiveCloudSelfPresetId()
  if (activeId) {
    const hit = list.find((x) => x.id === activeId)
    if (hit) return hit
  }
  return list[0] || null
}

