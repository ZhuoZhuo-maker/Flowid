import { loadLicenseServerConfig } from './licenseAccess'
import { workflowNameSuggestsMultiangle } from './workflowMultiangleSupport'

export type CloudWorkflowMeta = {
  id: string
  name: string
  description: string
  nodeKind: string
  /** 服务端推导；`true`/`false` 优先，缺省时用名称启发（兼容旧版 GET /cloud-workflows） */
  supportsMultiangle?: boolean
}

function normalizeAuthBase(): string {
  return String(loadLicenseServerConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
}

export async function fetchCloudWorkflowJson(workflowId: string): Promise<{
  ok: boolean
  id: string
  name: string
  workflowJson: string
  message?: string
  status?: number
}> {
  const id = String(workflowId || '').trim()
  const base = normalizeAuthBase()
  if (!base || !id) {
    return {
      ok: false,
      id,
      name: '',
      workflowJson: '',
      message: !base ? '未配置授权服务地址' : '工作流 id 为空',
    }
  }
  try {
    const res = await fetch(`${base}/cloud-workflows/${encodeURIComponent(id)}/workflow`, {
      cache: 'no-store',
    })
    const j = (await res.json().catch(() => ({}))) as {
      workflowJson?: string
      name?: string
      id?: string
      message?: string
    }
    const workflowJson = String(j.workflowJson || '').trim()
    return {
      ok: res.ok && Boolean(workflowJson),
      id: String(j.id || id).trim() || id,
      name: String(j.name || '').trim(),
      workflowJson,
      message: String(j.message || '').trim() || undefined,
      status: res.status,
    }
  } catch (e) {
    return {
      ok: false,
      id,
      name: '',
      workflowJson: '',
      message: String((e as { message?: string })?.message || e),
    }
  }
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
      const sm = rec.supportsMultiangle
      const supportsMultiangle =
        sm === true ? true : sm === false ? false : workflowNameSuggestsMultiangle(name)
      out.push({
        id,
        name,
        description: String(rec.description || '').trim().slice(0, 500),
        nodeKind: String(rec.nodeKind || '').trim().slice(0, 32),
        supportsMultiangle,
      })
    }
    return out
  } catch {
    return []
  }
}
