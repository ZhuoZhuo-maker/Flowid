export type CloudProviderId = 'doubao' | 'gemini' | 'openai'

/** custom：用户自填 baseUrl；official：baseUrl 由构建环境变量注入，不落盘到 localStorage */
export type CloudSelfConnectionSource = 'custom' | 'official'

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
  /** 默认 custom；official 时不在界面展示 API 地址，且保存时不写入 baseUrl */
  connectionSource?: CloudSelfConnectionSource
}

const KEY_LIST = 'flowid.cloud.self.presets.v1'
const KEY_ACTIVE = 'flowid.cloud.self.activePresetId.v1'
const MAX_ITEMS = 50

function parseConnectionSource(v: unknown): CloudSelfConnectionSource {
  return v === 'official' ? 'official' : 'custom'
}

/**
 * 平台固定线路：各厂商 OpenAI 兼容根 URL，由打包时 `VITE_CLOUD_OFFICIAL_*` 注入（勿提交真实密钥到 Git）。
 */
export function getOfficialCloudBaseUrl(providerId: CloudProviderId): string {
  try {
    const env = import.meta.env as Record<string, string | undefined>
    if (providerId === 'doubao') return String(env.VITE_CLOUD_OFFICIAL_DOUBAO_URL || '').trim()
    if (providerId === 'gemini') return String(env.VITE_CLOUD_OFFICIAL_GEMINI_URL || '').trim()
    if (providerId === 'openai') return String(env.VITE_CLOUD_OFFICIAL_OPENAI_URL || '').trim()
  } catch {
    /* ignore */
  }
  return ''
}

export function hasOfficialCloudBaseUrl(providerId: CloudProviderId): boolean {
  return Boolean(getOfficialCloudBaseUrl(providerId))
}

export function resolveCloudSelfPreset(p: CloudSelfPreset | null): {
  baseUrl: string
  apiKey: string
  model: string
  providerId: CloudProviderId
} | null {
  if (!p || !p.id || !p.providerId) return null
  const src = parseConnectionSource(p.connectionSource)
  if (src === 'official') {
    const baseUrl = getOfficialCloudBaseUrl(p.providerId)
    if (!baseUrl) return null
    return {
      baseUrl,
      apiKey: String(p.apiKey || '').trim(),
      model: String(p.model || '').trim(),
      providerId: p.providerId,
    }
  }
  const baseUrl = String(p.baseUrl || '').trim()
  if (!baseUrl) return null
  return {
    baseUrl,
    apiKey: String(p.apiKey || '').trim(),
    model: String(p.model || '').trim(),
    providerId: p.providerId,
  }
}

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
        connectionSource: parseConnectionSource((p as any)?.connectionSource),
      }))
      .filter((p) => {
        if (!p.id || !p.providerId) return false
        if (p.connectionSource === 'official') {
          return Boolean(p.model && p.apiKey && getOfficialCloudBaseUrl(p.providerId))
        }
        return Boolean(p.baseUrl || p.apiKey || p.model)
      })
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
  const src = parseConnectionSource((patch as any).connectionSource ?? base.connectionSource)
  const merged: CloudSelfPreset = {
    ...base,
    nodeKind: String(patch.nodeKind || ''),
    providerId: patch.providerId,
    baseUrl: src === 'official' ? '' : String(patch.baseUrl || ''),
    apiKey: String(patch.apiKey || ''),
    model: String(patch.model || ''),
    connectionSource: src,
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

/**
 * 与画布执行逻辑一致：按当前「使用」的自助预设 + 节点类型，解析出 model / baseUrl / apiKey。
 */
export function getActiveCloudSelfDefaultsForNodeKind(nodeKind: string): { model: string; baseUrl: string; apiKey: string } {
  const list = loadCloudSelfPresets()
  const activeId = String(loadActiveCloudSelfPresetId() || '').trim()
  const byNodeKind = list.filter((x) => {
    const nk = String(x.nodeKind || '').trim()
    return !nk || nk === nodeKind
  })
  const hit =
    (activeId ? byNodeKind.find((x) => x.id === activeId) : null) ||
    byNodeKind[0] ||
    (activeId ? list.find((x) => x.id === activeId) : null) ||
    list[0] ||
    null
  const r = resolveCloudSelfPreset(hit)
  if (!r) return { model: '', baseUrl: '', apiKey: '' }
  return { model: r.model, baseUrl: r.baseUrl, apiKey: r.apiKey }
}

