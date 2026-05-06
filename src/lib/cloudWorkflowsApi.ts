import { loadLicenseServerConfig } from './licenseAccess'

export type CloudWorkflowMeta = {
  id: string
  name: string
  description: string
  nodeKind: string
}

function normalizeAuthBase(): string {
  return String(loadLicenseServerConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
}

export async function fetchCloudWorkflowsMeta(): Promise<CloudWorkflowMeta[]> {
  const base = normalizeAuthBase()
  if (!base) return []
  try {
    const res = await fetch(`${base}/cloud-workflows`)
    if (!res.ok) return []
    const j = (await res.json().catch(() => ({}))) as { workflows?: unknown[] }
    const raw = Array.isArray(j.workflows) ? j.workflows : []
    const out: CloudWorkflowMeta[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const id = String(rec.id || '').trim()
      const name = String(rec.name || '').trim()
      if (!id || !name) continue
      out.push({
        id,
        name,
        description: String(rec.description || '').trim().slice(0, 500),
        nodeKind: String(rec.nodeKind || '').trim().slice(0, 32),
      })
    }
    return out
  } catch {
    return []
  }
}
