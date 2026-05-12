import type { Node } from '@xyflow/react'
import type { StudioNodeData } from '../types'
import type { CloudAssistKind } from './cloudAssistModelCatalog'
import {
  studioNodeKindToAssistKind,
  tryDecodeCloudAssistModelPick,
} from './cloudAssistModelCatalog'

/** 清空所有画布节点上缓存的 `cloudApiKey`（与设置里移除 Key 的语义一致） */
export function stripCloudApiKeyFromAllStudioNodes(
  nodes: Array<Node<StudioNodeData>>,
): Array<Node<StudioNodeData>> {
  let changed = false
  const next = nodes.map((n) => {
    if (!String((n.data as { cloudApiKey?: string }).cloudApiKey || '').trim()) return n
    changed = true
    return { ...n, data: { ...n.data, cloudApiKey: '' } as StudioNodeData }
  })
  return changed ? next : nodes
}

/** 某类辅助线路 Key 被删除时：清掉对应画布节点上的 Assist 绑定与缓存 Key（不碰带自助预设 id 的节点，除非其明确选了辅助线路） */
export function clearAssistModelBindingForAssistKinds(
  nodes: Array<Node<StudioNodeData>>,
  kinds: CloudAssistKind[],
): Array<Node<StudioNodeData>> {
  if (!kinds.length) return nodes
  const set = new Set(kinds)
  let changed = false
  const next = nodes.map((n) => {
    const ak = studioNodeKindToAssistKind(n.data.kind)
    if (!ak || !set.has(ak)) return n
    const d = n.data as StudioNodeData & {
      cloudAssistModelPick?: string
      cloudSelfPresetId?: string
      cloudApiKey?: string
      cloudModelName?: string
      cloudModelUrl?: string
    }
    const pick = String(d.cloudAssistModelPick || '').trim()
    const hasAssistPick = Boolean(pick && tryDecodeCloudAssistModelPick(pick))
    const selfId = String(d.cloudSelfPresetId || '').trim()
    if (!hasAssistPick && selfId) return n
    if (!hasAssistPick && !String(d.cloudApiKey || '').trim()) return n
    changed = true
    return {
      ...n,
      data: {
        ...d,
        cloudAssistModelPick: undefined,
        cloudModelName: '',
        cloudModelUrl: '',
        cloudApiKey: '',
      } as StudioNodeData,
    }
  })
  return changed ? next : nodes
}
