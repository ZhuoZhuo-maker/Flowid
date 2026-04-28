import { loadAuthApiConfig, loadAuthSession } from './auth'

const SYSTEM_PROMPT_ACTIVE_ID_KEY = 'flowid.systemPrompt.activePresetId.v1'
const DEFAULT_AUTH_BASE_URL = 'http://127.0.0.1:3721'

export type SystemPromptPresetMeta = {
  id: string
  name: string
  version: string
  category: string
  description: string
}

export function loadActiveSystemPromptPresetId(): string {
  try {
    return String(localStorage.getItem(SYSTEM_PROMPT_ACTIVE_ID_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function saveActiveSystemPromptPresetId(id: string): void {
  try {
    localStorage.setItem(SYSTEM_PROMPT_ACTIVE_ID_KEY, String(id || '').trim())
  } catch {
    // ignore
  }
}

function getAuthBaseAndToken(): { baseUrl: string; token: string } | null {
  const api = loadAuthApiConfig()
  const session = loadAuthSession()
  const configured = String(api.baseUrl || '').trim().replace(/\/+$/, '')
  const baseUrl =
    configured ||
    (typeof window !== 'undefined' ? DEFAULT_AUTH_BASE_URL : '')
  const token = String(session?.token || '').trim()
  if (!baseUrl || !token) return null
  return { baseUrl, token }
}

export type SystemPromptPresetClientStatus =
  | { ok: true; baseUrl: string; hasToken: true }
  | { ok: false; baseUrl: string; hasToken: false; reason: 'missing_base_url' | 'missing_token' }

export function getSystemPromptPresetClientStatus(): SystemPromptPresetClientStatus {
  const api = loadAuthApiConfig()
  const session = loadAuthSession()
  const configured = String(api.baseUrl || '').trim().replace(/\/+$/, '')
  const baseUrl = configured || (typeof window !== 'undefined' ? DEFAULT_AUTH_BASE_URL : '')
  const token = String(session?.token || '').trim()
  if (!baseUrl) return { ok: false, baseUrl: '', hasToken: false, reason: 'missing_base_url' }
  if (!token) return { ok: false, baseUrl, hasToken: false, reason: 'missing_token' }
  return { ok: true, baseUrl, hasToken: true }
}

export async function fetchSystemPromptPresets(): Promise<SystemPromptPresetMeta[]> {
  const auth = getAuthBaseAndToken()
  if (!auth) return []
  const res = await fetch(`${auth.baseUrl}/system-prompts`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${auth.token}` },
  })
  const json = (await res.json().catch(() => ({}))) as { prompts?: unknown[] }
  if (!res.ok) return []
  const list = Array.isArray(json.prompts) ? json.prompts : []
  return list
    .map((item) => {
      const v = item as Record<string, unknown>
      return {
        id: String(v.id || '').trim(),
        name: String(v.name || '').trim(),
        version: String(v.version || '').trim(),
        category: String(v.category || '').trim() || 'general',
        description: String(v.description || '').trim(),
      } satisfies SystemPromptPresetMeta
    })
    .filter((p) => p.id && p.name)
}

export async function fetchSystemPromptPresetText(id: string): Promise<string> {
  const trimmed = String(id || '').trim()
  if (!trimmed) return ''
  const auth = getAuthBaseAndToken()
  if (!auth) return ''
  const res = await fetch(`${auth.baseUrl}/system-prompts/${encodeURIComponent(trimmed)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${auth.token}` },
  })
  const json = (await res.json().catch(() => ({}))) as { systemPromptText?: unknown }
  if (!res.ok) return ''
  return String(json.systemPromptText || '').trim()
}

