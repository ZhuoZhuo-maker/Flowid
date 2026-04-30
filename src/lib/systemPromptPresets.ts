import { loadLicenseServerConfig, loadLicenseSnapshotV2 } from './licenseAccess'

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

function getBaseAndOptionalHeaders(): { baseUrl: string; headers?: Record<string, string> } | null {
  const cfg = loadLicenseServerConfig()
  const snap = loadLicenseSnapshotV2()
  const configured = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
  const baseUrl = configured || (typeof window !== 'undefined' ? DEFAULT_AUTH_BASE_URL : '')
  const licenseCode = String(snap?.licenseCode || '').trim()
  const machineId = String(snap?.machineId || '').trim()
  if (!baseUrl) return null
  if (!licenseCode || !machineId) return { baseUrl }
  return { baseUrl, headers: { 'x-license-code': licenseCode, 'x-machine-id': machineId } }
}

export type SystemPromptPresetClientStatus =
  | { ok: true; baseUrl: string; hasLicense: boolean }
  | { ok: false; baseUrl: string; hasLicense: false; reason: 'missing_base_url' }

export function getSystemPromptPresetClientStatus(): SystemPromptPresetClientStatus {
  const cfg = loadLicenseServerConfig()
  const snap = loadLicenseSnapshotV2()
  const configured = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
  const baseUrl = configured || (typeof window !== 'undefined' ? DEFAULT_AUTH_BASE_URL : '')
  const hasLicense = Boolean(String(snap?.licenseCode || '').trim()) && Boolean(String(snap?.machineId || '').trim())
  if (!baseUrl) return { ok: false, baseUrl: '', hasLicense: false, reason: 'missing_base_url' }
  return { ok: true, baseUrl, hasLicense }
}

export async function fetchSystemPromptPresets(): Promise<SystemPromptPresetMeta[]> {
  const ctx = getBaseAndOptionalHeaders()
  if (!ctx) return []
  const res = await fetch(`${ctx.baseUrl}/system-prompts/groups`, {
    method: 'GET',
    headers: ctx.headers,
  })
  const json = (await res.json().catch(() => ({}))) as {
    groups?: Array<{ id?: string; label?: string; tier?: string; items?: unknown[] }>
  }
  if (!res.ok) return []
  const groups = Array.isArray(json.groups) ? json.groups : []
  const out: SystemPromptPresetMeta[] = []
  for (const g of groups) {
    const tier = String(g?.tier || '').trim() === 'pro' ? 'pro' : 'free'
    const prefix = tier === 'pro' ? '会员' : '免费'
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
        category: `${prefix}/${category}`,
        description: String(v.description || '').trim(),
        tier,
      })
    }
  }
  return out
}

export async function fetchSystemPromptPresetText(id: string): Promise<string> {
  const trimmed = String(id || '').trim()
  if (!trimmed) return ''
  const ctx = getBaseAndOptionalHeaders()
  if (!ctx) return ''
  const res = await fetch(`${ctx.baseUrl}/system-prompts/${encodeURIComponent(trimmed)}`, {
    method: 'GET',
    headers: ctx.headers,
  })
  const json = (await res.json().catch(() => ({}))) as { systemPromptText?: unknown }
  if (!res.ok) return ''
  return String(json.systemPromptText || '').trim()
}

