import type { ProjectSnapshot } from '../types'
import { parseProjectFile } from './persistence'
import { loadLicenseServerConfig, loadLicenseSnapshotV2 } from './licenseAccess'

/** 画布拖拽预设卡片时使用 */
export const FLOWID_PRESET_TEMPLATE_DRAG_MIME = 'application/x-flowid-preset-template' as const

export type PresetTemplate = {
  id: string
  name: string
  category: string
  image: string
  description: string
  tier: 'free' | 'pro'
}

function hashToHue(input: string): number {
  const s = String(input || '')
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h % 360
}

export function makePresetThumbDataUri(seed: string): string {
  const hue = hashToHue(seed)
  const h2 = (hue + 42) % 360
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue}, 70%, 28%)"/>
        <stop offset="1" stop-color="hsl(${h2}, 70%, 20%)"/>
      </linearGradient>
      <radialGradient id="r" cx="30%" cy="20%" r="80%">
        <stop offset="0" stop-color="rgba(234,88,12,0.22)"/>
        <stop offset="1" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="750" fill="url(#g)"/>
    <rect width="1200" height="750" fill="url(#r)"/>
    <g opacity="0.18" fill="white">
      <circle cx="220" cy="240" r="120"/>
      <circle cx="980" cy="140" r="90"/>
      <circle cx="780" cy="560" r="160"/>
    </g>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 预设模板列表仅从后端拉取，不再使用本地占位假数据 */
export type PresetTemplateCatalogResult =
  | { ok: true; items: PresetTemplate[] }
  | { ok: false; reason: 'no_base_url' | 'request_failed'; message: string }

export function buildPresetTemplateCategoryTabs(
  templates: PresetTemplate[],
  /** @deprecated 已不再按会员过滤，保留参数以兼容旧调用 */
  _accessValid?: boolean,
): string[] {
  const visible = templates
  const set = new Set<string>()
  for (const t of visible) {
    const c = String(t.category || '').trim()
    if (c) set.add(c)
  }
  return ['全部', ...[...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))]
}

export function filterPresetTemplatesByCategory(
  templates: PresetTemplate[],
  category: string,
  /** @deprecated 已不再按会员过滤 */
  _accessValid?: boolean,
): PresetTemplate[] {
  const byCat =
    category === '全部' ? templates : templates.filter((t) => t.category === category)
  return byCat
}

export async function fetchPresetTemplatesFromServer(): Promise<PresetTemplateCatalogResult> {
  const base = String(loadLicenseServerConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base) {
    return {
      ok: false,
      reason: 'no_base_url',
      message:
        '未配置授权服务地址，无法加载预设模板。请在「设置 → 授权」中填写后端根地址（与浏览器能打开 /healthz 的地址一致）；使用内测安装包时通常已内置，若仍出现本提示可联系管理员。',
    }
  }
  const snap = loadLicenseSnapshotV2()
  const headers: Record<string, string> = {}
  if (snap?.licenseCode && snap?.machineId) {
    headers['x-license-code'] = snap.licenseCode
    headers['x-machine-id'] = snap.machineId
  }
  try {
    const res = await fetch(`${base}/templates/groups`, { headers })
    const json = (await res.json().catch(() => ({}))) as {
      groups?: Array<{ items?: unknown[] }>
      message?: string
    }
    if (!res.ok) {
      throw new Error(String(json.message || `拉取模板列表失败：HTTP ${res.status}`))
    }
    const groups = Array.isArray(json.groups) ? json.groups : []
    const items: PresetTemplate[] = []
    for (const g of groups) {
      const rowItems = Array.isArray(g.items) ? g.items : []
      for (const raw of rowItems) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
        const row = raw as Record<string, unknown>
        const id = String(row.id || '').trim()
        if (!id) continue
        const tierRaw = String(row.tier || 'free').toLowerCase()
        const tier: PresetTemplate['tier'] = tierRaw === 'pro' ? 'pro' : 'free'
        items.push({
          id,
          name: String(row.name || id),
          category: String(row.category || 'image').trim() || 'image',
          image: makePresetThumbDataUri(id),
          description: String(row.description || ''),
          tier,
        })
      }
    }
    return { ok: true, items }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e || '未知错误')
    return {
      ok: false,
      reason: 'request_failed',
      message: `无法从后端获取预设模板列表（${msg}）。请检查网络、后端是否运行，以及 GET ${base}/templates/groups 是否可访问。`,
    }
  }
}

export async function fetchPresetTemplateWorkflowText(templateId: string): Promise<string> {
  const base = String(loadLicenseServerConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base) {
    throw new Error(
      '未配置授权服务地址：请在工作区「工作流 / 授权」相关设置中填写可访问的授权服务 baseUrl（开发环境常见为 http://127.0.0.1:3721）。',
    )
  }
  const snapTok = loadLicenseSnapshotV2()
  const headers: Record<string, string> = {}
  if (snapTok?.licenseCode && snapTok?.machineId) {
    headers['x-license-code'] = snapTok.licenseCode
    headers['x-machine-id'] = snapTok.machineId
  }
  const workflowUrls = [
    `${base}/templates/${encodeURIComponent(templateId)}/workflow`,
    `${base}/templates/${encodeURIComponent(templateId)}/workflow.json`,
  ]
  let res: Response | null = null
  for (const u of workflowUrls) {
    const r = await fetch(u, { headers })
    res = r
    if (r.ok) break
    if (r.status !== 404) break
  }
  if (!res) throw new Error('加载预设失败：未发起请求')
  if (res.status === 403) throw new Error('MEMBER_ONLY')
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string }
    const detail = j.message ? String(j.message) : ''
    if (res.status === 404) {
      throw new Error(
        [
          '加载预设失败（404）。常见原因：',
          '1）授权服务不是最新代码：`GET /templates/:id/workflow` 未注册，请部署并重启当前连接的 auth-server。',
          '2）模板索引存在但磁盘缺少 workflow 文件：请在管理后台检查该模板或重新上传预设 JSON。',
          detail ? `服务端说明：${detail}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
    throw new Error(detail || `加载预设失败（${res.status}）`)
  }
  return res.text()
}

export async function loadPresetTemplateSnapshot(templateId: string): Promise<ProjectSnapshot> {
  const text = await fetchPresetTemplateWorkflowText(templateId)
  return parseProjectFile(text)
}

export type PresetTemplateDragPayload = Pick<PresetTemplate, 'id' | 'name' | 'tier'>

export function parsePresetTemplateDragPayload(dt: DataTransfer | null): PresetTemplateDragPayload | null {
  if (!dt) return null
  const raw = dt.getData(FLOWID_PRESET_TEMPLATE_DRAG_MIME)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { id?: string; name?: string; tier?: string }
    const id = String(v?.id || '').trim()
    if (!id) return null
    const tierRaw = String(v?.tier || 'free').toLowerCase()
    return {
      id,
      name: String(v?.name || id),
      tier: tierRaw === 'pro' ? 'pro' : 'free',
    }
  } catch {
    return null
  }
}
