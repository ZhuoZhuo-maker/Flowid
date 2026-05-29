export type CloudProviderId = 'doubao' | 'gemini' | 'openai'

/** @deprecated 仅兼容旧数据；新配置不再展示分类 */
export type CloudSelfConnectionSource = 'custom' | 'official'

/** API 调用方式：auto 根据地址与响应自动判断 */
export type CloudSelfApiMode = 'auto' | 'openai' | 'async'

export type CloudSelfPreset = {
  id: string
  /** 匹配的节点类型（为空表示可用于任意节点） */
  nodeKind?: string
  /** @deprecated 旧版分类字段，新配置可省略 */
  providerId?: CloudProviderId
  baseUrl: string
  apiKey: string
  model: string
  createdAtMs: number
  updatedAtMs: number
  /** @deprecated 旧版平台固定线路 */
  connectionSource?: CloudSelfConnectionSource
  /** 默认 auto：OpenAI 同步或 ModelScope 式异步 */
  apiMode?: CloudSelfApiMode
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

export function parseCloudSelfApiMode(v: unknown): CloudSelfApiMode {
  if (v === 'openai' || v === 'async') return v
  return 'auto'
}

export function resolveCloudSelfPreset(p: CloudSelfPreset | null): {
  baseUrl: string
  apiKey: string
  model: string
  apiMode: CloudSelfApiMode
} | null {
  if (!p || !p.id) return null
  const apiMode = parseCloudSelfApiMode(p.apiMode)
  const src = parseConnectionSource(p.connectionSource)
  if (src === 'official' && p.providerId) {
    const baseUrl = getOfficialCloudBaseUrl(p.providerId)
    if (!baseUrl) return null
    return {
      baseUrl,
      apiKey: String(p.apiKey || '').trim(),
      model: String(p.model || '').trim(),
      apiMode,
    }
  }
  const baseUrl = String(p.baseUrl || '').trim()
  if (!baseUrl) return null
  return {
    baseUrl,
    apiKey: String(p.apiKey || '').trim(),
    model: String(p.model || '').trim(),
    apiMode,
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
        apiMode: parseCloudSelfApiMode((p as any)?.apiMode),
      }))
      .filter((p) => {
        if (!p.id) return false
        if (p.connectionSource === 'official' && p.providerId) {
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
          apiMode: 'auto',
        }
  const src = parseConnectionSource((patch as any).connectionSource ?? base.connectionSource)
  const merged: CloudSelfPreset = {
    ...base,
    nodeKind: String(patch.nodeKind || ''),
    providerId: patch.providerId ?? base.providerId,
    baseUrl: src === 'official' ? '' : String(patch.baseUrl || ''),
    apiKey: String(patch.apiKey || ''),
    model: String(patch.model || ''),
    connectionSource: src,
    apiMode: parseCloudSelfApiMode((patch as any).apiMode ?? base.apiMode),
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
export function getActiveCloudSelfDefaultsForNodeKind(nodeKind: string): {
  model: string
  baseUrl: string
  apiKey: string
  apiMode: CloudSelfApiMode
} {
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
  if (!r) return { model: '', baseUrl: '', apiKey: '', apiMode: 'auto' }
  return { model: r.model, baseUrl: r.baseUrl, apiKey: r.apiKey, apiMode: r.apiMode }
}

