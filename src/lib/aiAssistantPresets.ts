import type { AiAssistantProvider } from './aiAssistantAgent'
import { sealSecret, unsealSecret } from './secretObfuscation'

export type AiAssistantCorePreset = {
  id: string
  name: string
  provider: AiAssistantProvider
  endpoint: string
  apiKey?: string
  model: string
}

const STORAGE_KEY = 'flowid.aiAssistant.corePresets.v1'

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadAiAssistantCorePresets(): AiAssistantCorePreset[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  const parsed = safeJsonParse<unknown>(raw)
  if (!Array.isArray(parsed)) return []
  const out: AiAssistantCorePreset[] = []
  for (const item of parsed) {
    const it = item as Partial<AiAssistantCorePreset>
    const id = typeof it.id === 'string' ? it.id.trim() : ''
    const name = typeof it.name === 'string' ? it.name.trim() : ''
    const provider = it.provider === 'cloud' ? 'cloud' : 'ollama'
    const endpoint = typeof it.endpoint === 'string' ? it.endpoint.trim() : ''
    const apiKeyRaw =
      typeof (it as any).apiKeyEnc === 'string' ? String((it as any).apiKeyEnc || '') : String((it as any).apiKey || '')
    const apiKey = apiKeyRaw ? unsealSecret(apiKeyRaw) : undefined
    const model = typeof it.model === 'string' ? it.model.trim() : ''
    if (!id || !name) continue
    out.push({ id, name, provider, endpoint, ...(apiKey != null ? { apiKey } : {}), model })
  }
  return out
}

export function saveAiAssistantCorePresets(next: AiAssistantCorePreset[]): void {
  if (typeof window === 'undefined') return
  const normalized = next
    .map((p) => ({
      id: String(p.id || '').trim(),
      name: String(p.name || '').trim(),
      provider: p.provider === 'cloud' ? 'cloud' : 'ollama',
      endpoint: String(p.endpoint || '').trim(),
      apiKeyEnc: sealSecret(String(p.apiKey || '')),
      model: String(p.model || '').trim(),
    }))
    .filter((p) => p.id && p.name)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent('flowid:ai-assistant-core-presets-changed'))
}

export function upsertAiAssistantCorePreset(preset: AiAssistantCorePreset): AiAssistantCorePreset[] {
  const list = loadAiAssistantCorePresets()
  const id = String(preset.id || '').trim()
  const next = list.some((p) => p.id === id)
    ? list.map((p) => (p.id === id ? { ...p, ...preset } : p))
    : [...list, preset]
  saveAiAssistantCorePresets(next)
  return next
}

export function removeAiAssistantCorePreset(id: string): AiAssistantCorePreset[] {
  const trimmed = String(id || '').trim()
  const next = loadAiAssistantCorePresets().filter((p) => p.id !== trimmed)
  saveAiAssistantCorePresets(next)
  return next
}

