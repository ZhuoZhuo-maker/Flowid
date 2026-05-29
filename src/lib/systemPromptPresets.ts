import { loadLicenseServerConfig } from './licenseAccess'

const SYSTEM_PROMPT_ACTIVE_ID_KEY = 'flowid.systemPrompt.activePresetId.v1'
const DEFAULT_AUTH_BASE_URL = 'http://127.0.0.1:3721'

export type SystemPromptPresetMeta = {
  id: string
  name: string
  version: string
  category: string
  description: string
  tier?: 'free' | 'pro'
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

function getBaseAndOptionalHeaders(): { baseUrl: string } | null {
  const cfg = loadLicenseServerConfig()
  const configured = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
  const baseUrl = configured || (typeof window !== 'undefined' ? DEFAULT_AUTH_BASE_URL : '')
  if (!baseUrl) return null
  return { baseUrl }
}

export type SystemPromptPresetClientStatus =
  | { ok: true; baseUrl: string }
  | { ok: false; baseUrl: string; reason: 'missing_base_url' }

export function getSystemPromptPresetClientStatus(): SystemPromptPresetClientStatus {
  const cfg = loadLicenseServerConfig()
  const configured = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
  const baseUrl = configured || (typeof window !== 'undefined' ? DEFAULT_AUTH_BASE_URL : '')
  if (!baseUrl) return { ok: false, baseUrl: '', reason: 'missing_base_url' }
  return { ok: true, baseUrl }
}

export type SystemPromptPresetsFetchResult = {
  items: SystemPromptPresetMeta[]
  categoryOrder: string[]
}

export async function fetchSystemPromptPresets(): Promise<SystemPromptPresetsFetchResult> {
  const ctx = getBaseAndOptionalHeaders()
  if (!ctx) return { items: [], categoryOrder: [] }
  const res = await fetch(`${ctx.baseUrl}/system-prompts/groups`, {
    method: 'GET',
  })
  const json = (await res.json().catch(() => ({}))) as {
    groups?: Array<{ id?: string; label?: string; tier?: string; items?: unknown[] }>
    categoryOrder?: unknown[]
  }
  if (!res.ok) return { items: [], categoryOrder: [] }
  const groups = Array.isArray(json.groups) ? json.groups : []
  const out: SystemPromptPresetMeta[] = []
  for (const g of groups) {
    const tier = String(g?.tier || '').trim() === 'pro' ? 'pro' : 'free'
    const items = Array.isArray(g?.items) ? g.items : []
    for (const item of items) {
      const v = item as Record<string, unknown>
      const id = String(v.id || '').trim()
      const name = String(v.name || '').trim()
      if (!id || !name) continue
      const category = String(v.category || '').trim() || 'general'
      out.push({
        id,
        name,
        version: String(v.version || '').trim(),
        category,
        description: String(v.description || '').trim(),
        tier,
      })
    }
  }
  const rawOrder = Array.isArray(json.categoryOrder) ? json.categoryOrder : []
  const categoryOrder: string[] = []
  const seen = new Set<string>()
  for (const x of rawOrder) {
    const s = String(x || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    categoryOrder.push(s)
  }
  return { items: out, categoryOrder }
}

export async function fetchSystemPromptPresetText(id: string): Promise<string> {
  const trimmed = String(id || '').trim()
  if (!trimmed) return ''
  const ctx = getBaseAndOptionalHeaders()
  if (!ctx) return ''
  const res = await fetch(`${ctx.baseUrl}/system-prompts/${encodeURIComponent(trimmed)}`, {
    method: 'GET',
  })
  const json = (await res.json().catch(() => ({}))) as { systemPromptText?: unknown }
  if (!res.ok) return ''
  return String(json.systemPromptText || '').trim()
}

