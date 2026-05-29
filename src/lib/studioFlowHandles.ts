import type { Edge, Node } from '@xyflow/react'
import type { StudioNodeData } from '../types'

/**
 * 画布节点左右连线桩的 React Flow `Handle` id。
 * 未设置 id 时，部分版本在连到左侧「+」后会得到 `targetHandle: null`，控制台报
 * `Couldn't create edge for target handle id: "null"`，且边数据不完整。
 */
export const STUDIO_FLOW_TARGET_HANDLE_ID = 'studio-in'
export const STUDIO_FLOW_SOURCE_HANDLE_ID = 'studio-out'

function isBlankFlowHandle(handle: string | null | undefined): boolean {
  const s = String(handle ?? '').trim()
  return !s || s === 'null'
}

/** 左侧单入边桩、读档时应规范为 `STUDIO_FLOW_TARGET_HANDLE_ID` 的节点类型 */
const STUDIO_INBOUND_TARGET_KINDS = new Set<string>(['image', 'text', 'script', 'audio', 'panorama'])

/** 右侧单出边桩、读档时应规范为 `STUDIO_FLOW_SOURCE_HANDLE_ID` 的节点类型（含视频右桩） */
const STUDIO_OUTBOUND_SOURCE_KINDS = new Set<string>(['image', 'text', 'script', 'audio', 'panorama', 'video'])

/**
 * 读档 / 导入 / 粘贴子图：将边的 `targetHandle`/`sourceHandle` 从 null、空串、字符串 `"null"`
 * 规范为与节点组件上声明的 Handle id 一致（视频目标桩由 `migrateVideoTargetEdges` 单独处理）。
 */
export function migrateStudioFlowHandleIds(
  nodes: Array<Node<StudioNodeData>>,
  edges: Edge[],
): Edge[] {
  const kindById = new Map(nodes.map((n) => [n.id, n.data?.kind as string | undefined]))
  return edges.map((e) => {
    let next = e
    const tgtKind = kindById.get(e.target)
    if (tgtKind && STUDIO_INBOUND_TARGET_KINDS.has(tgtKind) && isBlankFlowHandle(e.targetHandle)) {
      next = { ...next, targetHandle: STUDIO_FLOW_TARGET_HANDLE_ID }
    }
    const srcKind = kindById.get(e.source)
    if (srcKind && STUDIO_OUTBOUND_SOURCE_KINDS.has(srcKind) && isBlankFlowHandle(e.sourceHandle)) {
      next = { ...next, sourceHandle: STUDIO_FLOW_SOURCE_HANDLE_ID }
    }
    return next
  })
}
