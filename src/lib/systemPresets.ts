import type { StudioNodeKind } from '../types'

const KIND_SET: ReadonlySet<StudioNodeKind> = new Set([
  'text',
  'script',
  'image',
  'video',
  'audio',
  'music',
  'panorama',
])

/**
 * 系统预设清单中的一项（由 `public/system-presets/manifest.json` 提供，只读）。
 *
 * ## 管理员如何维护（用户无法在应用内改这些文件）
 * - 将 Comfy API 工作流 JSON 放到 `public/system-presets/` 下（可分子目录）。
 * - 编辑同目录 `manifest.json`：为每条预设填写 `id`、`name`、`kind`、`file`（`file` 为相对网站根的路径，如 `system-presets/image/foo.json`）。
 * - 重新构建/部署后，所有用户拉到的都是同一份只读清单与文件；用户点击预设后只会把**副本**写入其浏览器里的工作流配置（localStorage），不会回写 `public/`。
 *
 * ## 若必须「应用内编辑且仅管理员可改」
 * - 需要后端：系统预设存数据库或对象存储；普通用户只读 API；管理员带角色令牌才能 PUT。
 * - 前端任何「仅隐藏按钮」都防不住会改 localStorage 的用户，不能单独作为权限模型。
 */
export type SystemPresetManifestEntry = {
  id: string
  name: string
  kind: StudioNodeKind
  /** 相对站点根的路径，例如 `system-presets/image/portrait.json` */
  file: string
}

/**
 * 解析 `public/` 下静态资源的完整 URL（兼容 Vite `base` 子路径）。
 */
function resolvePublicUrl(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, '')
  const base = import.meta.env.BASE_URL || '/'
  return new URL(trimmed, `${window.location.origin}${base}`).href
}

function isManifestEntry(value: unknown): value is SystemPresetManifestEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const id = row.id
  const name = row.name
  const kind = row.kind
  const file = row.file
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof name === 'string' &&
    name.length > 0 &&
    typeof kind === 'string' &&
    KIND_SET.has(kind as StudioNodeKind) &&
    typeof file === 'string' &&
    file.length > 0
  )
}

/**
 * 拉取系统预设清单（失败时返回空数组，不抛错以免打断面板）。
 */
export async function fetchSystemPresetManifest(): Promise<SystemPresetManifestEntry[]> {
  const url = resolvePublicUrl('system-presets/manifest.json')
  try {
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) return []
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []
    return data.filter(isManifestEntry)
  } catch {
    return []
  }
}

/**
 * 读取单条预设的原始 JSON 文本（供写入用户工作流编辑区，即内存/ localStorage 副本）。
 */
export async function fetchSystemPresetJsonText(file: string): Promise<string> {
  const trimmed = file.trim().replace(/^\/+/, '')
  const url = resolvePublicUrl(trimmed)
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(`读取预设失败（${res.status}）：${trimmed}`)
  }
  return res.text()
}

/**
 * 按「全部 / 图片 / 视频」筛选清单项。
 */
export function filterManifestByPresetTab(
  entries: SystemPresetManifestEntry[],
  tab: 'all' | 'image' | 'video',
): SystemPresetManifestEntry[] {
  if (tab === 'image') return entries.filter((e) => e.kind === 'image')
  if (tab === 'video') return entries.filter((e) => e.kind === 'video')
  return entries
}
