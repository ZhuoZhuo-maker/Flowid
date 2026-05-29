import type { NodeResultThumbnail } from '../types'

/**
 * 输出条缩略图：去掉无有效 URL 的占位项，并按 url 去重保序。
 * blob / Comfy 链失效后常会留下空槽，导致底部出现黑块仍占位数。
 */
export function compactValidResultThumbnails(
  items: NodeResultThumbnail[] | undefined,
): NodeResultThumbnail[] {
  if (!items?.length) return []
  const seen = new Set<string>()
  const out: NodeResultThumbnail[] = []
  for (const t of items) {
    const url = String(t.url || '').trim()
    if (!url) continue
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ ...t, url })
  }
  return out
}
