export type CloudModelPreset = {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
}

const STORAGE_KEY = 'flowid.cloudModelPresets.v1'

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function getDefaultCloudModelPresets(): CloudModelPreset[] {
  return [
    { id: 'sdxl', name: 'SDXL', baseUrl: 'https://api.example.com/models/sdxl' },
    { id: 'flux', name: 'FLUX.1', baseUrl: 'https://api.example.com/models/flux1' },
    { id: 'wanx', name: 'WanX', baseUrl: 'https://api.example.com/models/wanx' },
  ]
}

export function loadCloudModelPresets(): CloudModelPreset[] {
  if (typeof window === 'undefined') return getDefaultCloudModelPresets()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return getDefaultCloudModelPresets()
  const parsed = safeJsonParse<unknown>(raw)
  if (!Array.isArray(parsed)) return getDefaultCloudModelPresets()
  const out: CloudModelPreset[] = []
  for (const item of parsed) {
    const it = item as Partial<CloudModelPreset>
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const name = typeof it.name === 'string' ? it.name.trim() : ''
    const baseUrl = typeof it.baseUrl === 'string' ? it.baseUrl.trim() : ''
    const apiKey = typeof it.apiKey === 'string' ? it.apiKey : undefined
    if (!id || !name) continue
    out.push({ id, name, baseUrl, ...(apiKey != null ? { apiKey } : {}) })
  }
  return out.length ? out : getDefaultCloudModelPresets()
}

export function saveCloudModelPresets(next: CloudModelPreset[]): void {
  if (typeof window === 'undefined') return
  const normalized = next
    .map((p) => ({
      id: String(p.id || '').trim(),
      name: String(p.name || '').trim(),
      baseUrl: String(p.baseUrl || '').trim(),
      apiKey: String(p.apiKey || ''),
    }))
    .filter((p) => p.id && p.name)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent('flowid:cloud-model-presets-changed'))
}

export function upsertCloudModelPreset(preset: CloudModelPreset): CloudModelPreset[] {
  const list = loadCloudModelPresets()
  const id = String(preset.id || '').trim()
  const next = list.some((p) => p.id === id)
    ? list.map((p) => (p.id === id ? { ...p, ...preset } : p))
    : [...list, preset]
  saveCloudModelPresets(next)
  return next
}

export function removeCloudModelPreset(id: string): CloudModelPreset[] {
  const trimmed = String(id || '').trim()
  const next = loadCloudModelPresets().filter((p) => p.id !== trimmed)
  saveCloudModelPresets(next)
  return next
}

