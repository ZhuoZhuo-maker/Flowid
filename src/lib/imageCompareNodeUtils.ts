import type { Node } from '@xyflow/react'
import type { ImageNodeData, StudioNodeData } from '../types'

/** 取图片节点当前可用于对比预览的 URL：主图优先，否则首张结果缩略图 */
export function getPrimaryImageDisplayUrlForCompare(node: Node<StudioNodeData>): string {
  if (node.data.kind !== 'image') return ''
  const d = node.data as ImageNodeData
  const src = String(d.src || '').trim()
  if (src) return src
  const thumbs = d.resultThumbnails ?? []
  for (const t of thumbs) {
    const u = String(t.url || '').trim()
    if (t.mediaKind === 'image' && u) return u
  }
  return ''
}
