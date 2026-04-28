import { sealSecret, unsealSecret } from './secretObfuscation'

export type TtsPreset = {
  id: string
  name: string
  endpoint: string
  apiKey?: string
  model: string
  voice: string
}

const STORAGE_KEY = 'flowid.aiAssistant.ttsPresets.v1'

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadTtsPresets(): TtsPreset[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  const parsed = safeJsonParse<unknown>(raw)
  if (!Array.isArray(parsed)) return []
  const out: TtsPreset[] = []
  for (const item of parsed) {
    const it = item as Partial<TtsPreset>
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const name = typeof it.name === 'string' ? it.name.trim() : ''
    const endpoint = typeof it.endpoint === 'string' ? it.endpoint.trim() : ''
    const apiKeyRaw = typeof (it as any).apiKeyEnc === 'string' ? String((it as any).apiKeyEnc || '') : String((it as any).apiKey || '')
    const apiKey = apiKeyRaw ? unsealSecret(apiKeyRaw) : undefined
    const model = typeof it.model === 'string' ? it.model.trim() : ''
    const voice = typeof it.voice === 'string' ? it.voice.trim() : ''
    if (!id || !name) continue
    out.push({ id, name, endpoint, ...(apiKey != null ? { apiKey } : {}), model, voice })
  }
  return out
}

export function saveTtsPresets(next: TtsPreset[]): void {
  if (typeof window === 'undefined') return
  const normalized = next
    .map((p) => ({
      id: String(p.id || '').trim(),
      name: String(p.name || '').trim(),
      endpoint: String(p.endpoint || '').trim(),
      apiKeyEnc: sealSecret(String(p.apiKey || '')),
      model: String(p.model || '').trim(),
      voice: String(p.voice || '').trim(),
    }))
    .filter((p) => p.id && p.name)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent('flowid:tts-presets-changed'))
}

export function upsertTtsPreset(preset: TtsPreset): TtsPreset[] {
  const list = loadTtsPresets()
  const id = String(preset.id || '').trim()
  const next = list.some((p) => p.id === id)
    ? list.map((p) => (p.id === id ? { ...p, ...preset } : p))
    : [...list, preset]
  saveTtsPresets(next)
  return next
}

export function removeTtsPreset(id: string): TtsPreset[] {
  const trimmed = String(id || '').trim()
  const next = loadTtsPresets().filter((p) => p.id !== trimmed)
  saveTtsPresets(next)
  return next
}

