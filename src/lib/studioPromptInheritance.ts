import type { Edge, Node } from '@xyflow/react'
import type { ImageNodeData, StudioNodeData } from '../types'

function collectInboundTextScriptIdsForImage(
  imageId: string,
  edges: Edge[],
  nodes: Array<Node<StudioNodeData>>,
): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const e of edges) {
    let sid: string | undefined
    if (e.target === imageId) {
      const n = nodes.find((x) => x.id === e.source)
      if (n?.data?.kind === 'text' || n?.data?.kind === 'script') sid = e.source
    } else if (e.source === imageId) {
      const n = nodes.find((x) => x.id === e.target)
      if (n?.data?.kind === 'text' || n?.data?.kind === 'script') sid = e.target
    }
    if (!sid || seen.has(sid)) continue
    seen.add(sid)
    ids.push(sid)
  }
  ids.sort((a, b) => {
    const na = nodes.find((x) => x.id === a)
    const nb = nodes.find((x) => x.id === b)
    const ya = na?.position.y ?? 0
    const yb = nb?.position.y ?? 0
    if (ya !== yb) return ya - yb
    return (na?.position.x ?? 0) - (nb?.position.x ?? 0)
  })
  return ids
}

function textScriptBody(n: Node<StudioNodeData>): string {
  const k = n.data.kind
  if (k !== 'text' && k !== 'script') return ''
  return String((n.data as { body?: string }).body ?? '').trim()
}

/**
 * 执行前：仅图片节点——把「已连线但未写进提示框」的文字/剧本正文前插到 __PROMPT__。
 * 视频多路提示由 `prompt`～`prompt4` 与面板分隔符维护，不在此合并。
 */
export function cloneNodeWithInboundTextPromptPrepended(
  node: Node<StudioNodeData>,
  edges: Edge[] | undefined,
  allNodes: Array<Node<StudioNodeData>> | undefined,
  workflowSource?: string,
): Node<StudioNodeData> {
  if (!edges?.length || !allNodes?.length) return node
  const wf = String(workflowSource ?? '')

  if (node.data.kind === 'image') {
    if (wf && !wf.includes('__PROMPT__')) return node
    const im = node.data as ImageNodeData
    const prompt = String(im.prompt ?? '').trim()
    const inboundIds = collectInboundTextScriptIdsForImage(node.id, edges, allNodes)
    const inherited: string[] = []
    for (const sid of inboundIds) {
      const n = allNodes.find((x) => x.id === sid)
      if (!n) continue
      const body = textScriptBody(n)
      if (!body) continue
      if (prompt.includes(body)) continue
      inherited.push(body)
    }
    if (!inherited.length) return node
    const merged = [inherited.join('\n\n'), prompt].filter(Boolean).join('\n\n')
    return {
      ...node,
      data: {
        ...im,
        prompt: merged,
      } as StudioNodeData,
    }
  }

  return node
}
