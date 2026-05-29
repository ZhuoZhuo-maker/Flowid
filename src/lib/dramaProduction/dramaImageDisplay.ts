import { toFileUrlForMaterial } from '../materialLibrary'

/**
 * 将节点产出 URL 转为短剧画布可展示的地址（支持 http / blob / file / 本地路径）。
 * @param raw 原始 URL 或磁盘路径
 */
export function dramaImageDisplayUrl(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (/^(https?:|blob:|data:)/i.test(s)) return s
  if (s.startsWith('file:')) return s
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/')) return toFileUrlForMaterial(s)
  return s
}
