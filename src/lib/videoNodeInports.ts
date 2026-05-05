import type { Edge, Node } from '@xyflow/react'
import type { StudioNodeData, StudioNodeKind } from '../types'

/**
 * 视频节点左侧唯一入边桩（画布上只显示一个「+」）。
 * 文本/剧本多路输入时，由 `computeVideoTextPromptSlot` 决定写入 `prompt` 还是 `prompt2`。
 */
export const VIDEO_IN_UNIFIED = 'video-in'

/** 旧版及曾用的分桩 id，读档时统一迁到 `VIDEO_IN_UNIFIED` */
const LEGACY_VIDEO_TARGET_HANDLES = new Set([
  'video-in-prompt',
  'video-in-prompt-1',
  'video-in-prompt-2',
  'video-in-image',
  'video-in-audio',
  'video-in-video',
])

export function isVideoUnifiedTargetHandle(id: string | null | undefined): boolean {
  if (!id) return true
  return id === VIDEO_IN_UNIFIED || LEGACY_VIDEO_TARGET_HANDLES.has(id)
}

/** 指向视频且应参与「文本口排序」的边（统一桩或旧桩） */
function isVideoTextRoutingEdge(e: Edge, videoId: string): boolean {
  if (e.target !== videoId) return false
  return isVideoUnifiedTargetHandle(e.targetHandle ?? '')
}

/**
 * 已连入视频统一入边桩的 text/script 上游 id（画布位置上→下、左→右）。
 * `ensureSourceId`：在「预览边集」尚未包含某条新边时，仍把该文本源纳入排序（与 `computeVideoTextPromptSlot` 一致）。
 */
export function collectInboundTextScriptIdsForVideo(
  videoId: string,
  edges: Edge[],
  nodes: Array<Node<StudioNodeData>>,
  ensureSourceId?: string,
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const e of edges) {
    if (!isVideoTextRoutingEdge(e, videoId)) continue
    const sid = e.source
    if (seen.has(sid)) continue
    const n = nodes.find((x) => x.id === sid)
    const k = n?.data?.kind
    if (k !== 'text' && k !== 'script') continue
    seen.add(sid)
    ids.push(sid)
  }
  if (ensureSourceId && !seen.has(ensureSourceId)) {
    const n = nodes.find((x) => x.id === ensureSourceId)
    if (n?.data.kind === 'text' || n?.data.kind === 'script') {
      ids.push(ensureSourceId)
      seen.add(ensureSourceId)
    }
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

/**
 * 在「即将连上」的边集上，按上游文本/剧本节点画布位置（上→下、左→右）决定写入第几路提示词。
 * 返回 1-based 路号：1～4 对应 `prompt`～`prompt4`，≥5 对应 `extraPrompts` 中下标 `返回值 - 5`。
 */
export function computeVideoTextPromptSlot(
  edges: Edge[],
  nodes: Array<Node<StudioNodeData>>,
  videoId: string,
  textSourceId: string,
): number {
  const ids = collectInboundTextScriptIdsForVideo(videoId, edges, nodes, textSourceId)
  const idx = ids.indexOf(textSourceId)
  if (idx < 0) return 1
  return idx + 1
}

const VIDEO_INBOUND_SOURCE_KINDS = new Set<StudioNodeKind | string>([
  'text',
  'script',
  'image',
  'panorama',
  'audio',
  'music',
  'video',
])

export function inferVideoTargetHandleForSourceKind(
  _kind: StudioNodeKind | string | undefined,
): string | null {
  return VIDEO_IN_UNIFIED
}

/** 是否允许该上游类型连入视频统一入边桩 */
export function shouldInheritIntoVideoOnConnect(
  sourceKind: StudioNodeKind | string | undefined,
  targetHandle: string | null | undefined,
): boolean {
  if (!targetHandle || isVideoUnifiedTargetHandle(targetHandle)) {
    return VIDEO_INBOUND_SOURCE_KINDS.has(String(sourceKind))
  }
  return false
}

export function attachVideoTargetHandleForEdge(
  edge: Edge,
  _sourceKind: StudioNodeKind | string | undefined,
  targetKind: StudioNodeKind | string | undefined,
): Edge {
  if (targetKind !== 'video') return edge
  return {
    ...edge,
    targetHandle: VIDEO_IN_UNIFIED,
  }
}

export function videoTargetHandleForPendingConnectReplace(params: {
  handleType: 'source' | 'target'
  anchorNodeId: string
  newNodeId: string
  newNodeKind: StudioNodeKind
  anchorKind: StudioNodeKind | string | undefined
}): string | undefined {
  const { handleType, newNodeKind, anchorKind } = params
  if (handleType === 'source') {
    if (newNodeKind !== 'video') return undefined
    return VIDEO_IN_UNIFIED
  }
  if (anchorKind !== 'video') return undefined
  return VIDEO_IN_UNIFIED
}

type NodeKindProbe = { id: string; data: { kind?: string } }

export function migrateVideoTargetEdges(nodes: NodeKindProbe[], edges: Edge[]): Edge[] {
  const kindById = new Map(nodes.map((n) => [n.id, n.data.kind as string | undefined]))
  return edges.map((e) => {
    if (kindById.get(e.target ?? '') !== 'video') return e
    if (e.targetHandle === VIDEO_IN_UNIFIED) return e
    return { ...e, targetHandle: VIDEO_IN_UNIFIED }
  })
}
