export type CloudModelPreset = {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
}

const STORAGE_KEY_LEGACY = 'flowid.cloudModelPresets.v1'
const STORAGE_KEY = 'flowid.cloudModelPresetsByKind.v2'
type ModelPresetScope = 'text' | 'script' | 'image' | 'video' | 'audio' | 'music' | 'panorama'
type PresetsByScope = Partial<Record<ModelPresetScope, CloudModelPreset[]>>

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function normalizeList(list: unknown): CloudModelPreset[] {
  if (!Array.isArray(list)) return []
  const out: CloudModelPreset[] = []
  for (const item of list) {
    const it = item as Partial<CloudModelPreset>
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const name = typeof it.name === 'string' ? it.name.trim() : ''
    const baseUrl = typeof it.baseUrl === 'string' ? it.baseUrl.trim() : ''
    const apiKey = typeof it.apiKey === 'string' ? it.apiKey : undefined
    if (!id || !name) continue
    out.push({ id, name, baseUrl, ...(apiKey != null ? { apiKey } : {}) })
  }
  return out
}

function loadAllByScope(): PresetsByScope {
  if (typeof window === 'undefined') return {}
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const parsed = raw ? safeJsonParse<unknown>(raw) : null
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const out: PresetsByScope = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k).trim() as ModelPresetScope
      out[key] = normalizeList(v)
    }
    return out
  }
  // legacy migrate: 老版本是单数组，这里仅迁移到 text，避免污染其它节点类型
  const legacyRaw = window.localStorage.getItem(STORAGE_KEY_LEGACY)
  const legacyParsed = legacyRaw ? safeJsonParse<unknown>(legacyRaw) : null
  const legacy = normalizeList(legacyParsed)
  if (!legacy.length) return {}
  const migrated: PresetsByScope = { text: legacy }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
  return migrated
}

export function loadCloudModelPresets(scope?: ModelPresetScope): CloudModelPreset[] {
  const all = loadAllByScope()
  if (!scope) {
    return Object.values(all).flatMap((v) => v || [])
  }
  return all[scope] || []
}

export function saveCloudModelPresets(next: CloudModelPreset[], scope: ModelPresetScope): void {
  if (typeof window === 'undefined') return
  const normalized = next
    .map((p) => ({
      id: String(p.id || '').trim(),
      name: String(p.name || '').trim(),
      baseUrl: String(p.baseUrl || '').trim(),
      apiKey: String(p.apiKey || ''),
    }))
    .filter((p) => p.id && p.name)
  const all = loadAllByScope()
  all[scope] = normalized
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  window.dispatchEvent(new CustomEvent('flowid:cloud-model-presets-changed'))
}

export function upsertCloudModelPreset(preset: CloudModelPreset, scope: ModelPresetScope): CloudModelPreset[] {
  const list = loadCloudModelPresets(scope)
  const id = String(preset.id || '').trim()
  const next = list.some((p) => p.id === id)
    ? list.map((p) => (p.id === id ? { ...p, ...preset } : p))
    : [...list, preset]
  saveCloudModelPresets(next, scope)
  return next
}

export function removeCloudModelPreset(id: string, scope: ModelPresetScope): CloudModelPreset[] {
  const trimmed = String(id || '').trim()
  const next = loadCloudModelPresets(scope).filter((p) => p.id !== trimmed)
  saveCloudModelPresets(next, scope)
  return next
}

