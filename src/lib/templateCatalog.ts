import type { ProjectSnapshot } from '../types'
import { hydratePresetSnapshotBundledMedia, hydrateUserPresetSnapshotMedia } from './presetTemplateMediaBundle'
import {
  isUserLocalPresetCatalogId,
  listUserPresetMeta,
  loadUserPresetWorkflowJson,
  toUserLocalPresetCatalogId,
} from './userPresetTemplateStore'
import { parseProjectFile } from './persistence'
import { loadLicenseServerConfig } from './licenseAccess'
import { fetchBundledJson, isLocalGalleryBundleEnabled, resolveBundledGalleryUrl } from './localGalleryBundle'

/** 画布拖拽预设卡片时使用 */
export const FLOWID_PRESET_TEMPLATE_DRAG_MIME = 'application/x-flowid-preset-template' as const

export type PresetTemplate = {
  id: string
  name: string
  category: string
  image: string
  description: string
  tier: 'free' | 'pro'
  /** 本机 IndexedDB 导入/保存的用户预设 */
  isUserLocal?: boolean
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
  | { ok: true; items: PresetTemplate[]; categoryOrder?: string[] }
  | { ok: false; reason: 'no_base_url' | 'request_failed'; message: string }

export function buildPresetTemplateCategoryTabs(
  templates: PresetTemplate[],
  categoryOrder?: string[] | null,
): string[] {
  const visible = templates
  const set = new Set<string>()
  for (const t of visible) {
    const c = String(t.category || '').trim()
    if (c) set.add(c)
  }
  const ordered: string[] = []
  const seen = new Set<string>()
  if (categoryOrder && categoryOrder.length) {
    for (const raw of categoryOrder) {
      const c = String(raw || '').trim()
      if (!c || seen.has(c)) continue
      seen.add(c)
      ordered.push(c)
    }
  }
  const rest = [...set]
    .filter((c) => !seen.has(c))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return ['全部', ...ordered, ...rest]
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

/** 预设 workflow 可能较大；过短易误杀，过长仍应给出可感知上限避免按钮永久「加载中」 */
const PRESET_WORKFLOW_FETCH_TIMEOUT_MS = 120_000

type PresetGroupsPayload = {
  groups?: Array<{ items?: unknown[] }>
  message?: string
  categoryOrder?: unknown[]
}

function parsePresetCategoryOrder(payload: PresetGroupsPayload | null): string[] | undefined {
  if (!payload) return undefined
  const raw = payload.categoryOrder
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    const s = String(x || '').trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out.length ? out : undefined
}

function presetItemsFromGroupsPayload(json: PresetGroupsPayload | null): PresetTemplate[] {
  if (!json) return []
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
  return items
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`加载预设超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络或后端是否卡住：${url}`)
    }
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`加载预设超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络或后端是否卡住：${url}`)
    }
    throw e
  } finally {
    clearTimeout(id)
  }
}

function userMetaToPresetTemplate(meta: {
  templateId: string
  name: string
  category: string
}): PresetTemplate {
  const catalogId = toUserLocalPresetCatalogId(meta.templateId)
  return {
    id: catalogId,
    name: meta.name,
    category: meta.category || '我的预设',
    image: makePresetThumbDataUri(catalogId),
    description: '',
    tier: 'free',
    isUserLocal: true,
  }
}

/** 合并本机用户预设与服务器/随包预设列表 */
export async function fetchPresetTemplateCatalog(): Promise<PresetTemplateCatalogResult> {
  const userMetas = await listUserPresetMeta()
  const userItems = userMetas.map(userMetaToPresetTemplate)
  const server = await fetchPresetTemplatesFromServer()
  if (!server.ok) {
    if (!userItems.length) return server
    return {
      ok: true,
      items: userItems,
      categoryOrder: userItems.some((t) => t.category === '我的预设') ? ['我的预设'] : undefined,
    }
  }
  const merged = [...userItems, ...server.items]
  const order = server.categoryOrder ? ['我的预设', ...server.categoryOrder] : undefined
  return { ok: true, items: merged, categoryOrder: userItems.length ? order : server.categoryOrder }
}

export async function fetchPresetTemplatesFromServer(): Promise<PresetTemplateCatalogResult> {
  if (isLocalGalleryBundleEnabled()) {
    const json = await fetchBundledJson<PresetGroupsPayload>('flowid-bundled/preset-groups.json')
    if (json && Array.isArray(json.groups)) {
      return {
        ok: true,
        items: presetItemsFromGroupsPayload(json),
        categoryOrder: parsePresetCategoryOrder(json),
      }
    }
    return {
      ok: false,
      reason: 'request_failed',
      message:
        '已启用本地画廊（VITE_FLOWID_LOCAL_GALLERY=1），但未找到或无法解析 flowid-bundled/preset-groups.json。请将 public/flowid-bundled/preset-groups.json 纳入构建后重试。',
    }
  }

  const base = String(loadLicenseServerConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base) {
    return {
      ok: false,
      reason: 'no_base_url',
      message:
        '未配置 Auth 服务地址，无法加载预设模板。开发环境请运行 npm run auth:dev（默认 http://127.0.0.1:3721）；打包版若已内置公网地址仍出现本提示，请检查网络与服务是否可达。',
    }
  }
  try {
    const res = await fetch(`${base}/templates/groups`)
    const json = (await res.json().catch(() => ({}))) as PresetGroupsPayload
    if (!res.ok) {
      throw new Error(String(json.message || `拉取模板列表失败：HTTP ${res.status}`))
    }
    return {
      ok: true,
      items: presetItemsFromGroupsPayload(json),
      categoryOrder: parsePresetCategoryOrder(json),
    }
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
  if (isUserLocalPresetCatalogId(templateId)) {
    return loadUserPresetWorkflowJson(templateId)
  }
  if (isLocalGalleryBundleEnabled()) {
    const url = resolveBundledGalleryUrl(
      `flowid-bundled/presets/workflows/${encodeURIComponent(templateId)}.json`,
    )
    const res = await fetchWithTimeout(url, {}, PRESET_WORKFLOW_FETCH_TIMEOUT_MS)
    if (res.ok) return res.text()
    if (res.status === 404) {
      throw new Error(
        `本地预设 workflow 缺失：public/flowid-bundled/presets/workflows/${encodeURIComponent(templateId)}.json（与 preset-groups 中 id 对应）`,
      )
    }
    const j = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(String(j.message || `加载本地预设失败（HTTP ${res.status}）`))
  }

  const base = String(loadLicenseServerConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base) {
    throw new Error(
      '未配置 Auth 服务地址（开发环境常见为 http://127.0.0.1:3721，请运行 npm run auth:dev）。',
    )
  }
  const workflowUrls = [
    `${base}/templates/${encodeURIComponent(templateId)}/workflow`,
    `${base}/templates/${encodeURIComponent(templateId)}/workflow.json`,
  ]
  let res: Response | null = null
  for (const u of workflowUrls) {
    const r = await fetchWithTimeout(u, {}, PRESET_WORKFLOW_FETCH_TIMEOUT_MS)
    res = r
    if (r.ok) break
    if (r.status !== 404) break
  }
  if (!res) throw new Error('加载预设失败：未发起请求')
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
  if (isUserLocalPresetCatalogId(templateId)) {
    const text = await loadUserPresetWorkflowJson(templateId)
    const snapshot = parseProjectFile(text)
    return hydrateUserPresetSnapshotMedia(snapshot, templateId)
  }
  const text = await fetchPresetTemplateWorkflowText(templateId)
  const snapshot = parseProjectFile(text)
  return hydratePresetSnapshotBundledMedia(snapshot)
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
