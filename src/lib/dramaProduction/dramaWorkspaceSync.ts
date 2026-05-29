import type { Node } from '@xyflow/react'
import type { StudioNodeData } from '../../types'
import type { DramaCharacter, DramaProductionState, DramaShot } from './types'
import { loadDramaProductionState, patchDramaProductionState } from './dramaStateStore'
import { notifyDramaStateChanged } from './dramaWorkspaceBridge'

/**
 * 将分镜列表格式化为文本节点内容。
 */
export function formatShotsForStoryboardNode(shots: DramaShot[]): string {
  if (!shots.length) return '（分镜表为空，Agent 写入或在此手动添加）'
  return shots
    .map(
      (s) =>
        `【镜头 ${s.index}】${s.title}\n景别：${s.shotType} · 场景：${s.scene}\n动作：${s.action}\n对白：${s.dialogue || '—'}\n生图：${s.imagePrompt || s.action}`,
    )
    .join('\n\n')
}

/**
 * 将角色列表格式化为文本。
 */
export function formatCharactersForNode(characters: DramaCharacter[]): string {
  if (!characters.length) return '（角色列表为空）'
  return characters
    .map((c) => `【${c.name}】\n性格：${c.personality}\n外貌：${c.appearance}\n背景：${c.background}`)
    .join('\n\n')
}

/**
 * 将制作参数格式化为「项目设定」节点文案。
 */
export function formatSpecForConceptNode(state: DramaProductionState): string {
  const s = state.spec
  return [
    '【项目设定 · 智剧通对齐】',
    `概念：${s.concept || '—'}`,
    `平台：${s.targetPlatform || '—'}`,
    `风格：${s.visualStyle || '—'}`,
    `画幅：${s.aspect}${s.customWidth ? ` (${s.customWidth}×${s.customHeight})` : ''}`,
    `镜头数：${s.shotCount}`,
    `备注：${s.toneNotes || '—'}`,
  ].join('\n')
}

type SyncDeps = {
  projectTabId: string
  getNodes: () => Node<StudioNodeData>[]
  updateNodeData: (id: string, patch: Partial<StudioNodeData>) => void
}

function findNodeByTitleKeyword(
  nodes: Node<StudioNodeData>[],
  keyword: string,
): Node<StudioNodeData> | null {
  const q = keyword.trim().toLowerCase()
  return (
    nodes.find(
      (n) =>
        n.type !== 'ghost' &&
        n.type !== 'group' &&
        String(n.data?.title || '')
          .toLowerCase()
          .includes(q),
    ) ?? null
  )
}

/**
 * 将制片结构化状态同步到画布节点（剧本 / 设定 / 分镜表）。
 */
export function syncDramaStateToCanvasNodes(state: DramaProductionState, deps: SyncDeps): void {
  const nodes = deps.getNodes()
  const scriptNode = findNodeByTitleKeyword(nodes, '剧本')
  if (scriptNode && state.scriptBody.trim()) {
    deps.updateNodeData(scriptNode.id, { kind: 'script', body: state.scriptBody })
  }
  const conceptNode = findNodeByTitleKeyword(nodes, '项目设定')
  if (conceptNode) {
    deps.updateNodeData(conceptNode.id, { kind: 'text', body: formatSpecForConceptNode(state) })
  }
  const storyNode = findNodeByTitleKeyword(nodes, '分镜表')
  if (storyNode) {
    deps.updateNodeData(storyNode.id, { kind: 'text', body: formatShotsForStoryboardNode(state.shots) })
  }
}

/**
 * 用户在工作台手改剧本后写回状态与节点。
 */
export function applyUserScriptEdit(
  projectTabId: string,
  body: string,
  deps: SyncDeps,
): DramaProductionState {
  const next = patchDramaProductionState(projectTabId, { scriptBody: body })
  syncDramaStateToCanvasNodes(next, deps)
  notifyDramaStateChanged()
  return next
}

/**
 * 用户手改分镜 JSON 文本（简化：整表替换）。
 */
export function applyUserShotsEdit(
  projectTabId: string,
  shots: DramaShot[],
  deps: SyncDeps,
): DramaProductionState {
  const next = patchDramaProductionState(projectTabId, { shots })
  syncDramaStateToCanvasNodes(next, deps)
  notifyDramaStateChanged()
  return next
}

/**
 * 用户手改角色列表。
 */
export function applyUserCharactersEdit(
  projectTabId: string,
  characters: DramaCharacter[],
  deps: SyncDeps,
): DramaProductionState {
  const next = patchDramaProductionState(projectTabId, { characters })
  syncDramaStateToCanvasNodes(next, deps)
  notifyDramaStateChanged()
  return next
}

/**
 * 用户手改制作参数摘要。
 */
export function applyUserSpecConceptEdit(
  projectTabId: string,
  concept: string,
  deps: SyncDeps,
): DramaProductionState {
  const cur = loadDramaProductionState(projectTabId) ?? patchDramaProductionState(projectTabId, {})
  const next = patchDramaProductionState(projectTabId, {
    spec: { ...cur.spec, concept },
  })
  syncDramaStateToCanvasNodes(next, deps)
  notifyDramaStateChanged()
  return next
}

export type DramaRightViewMode = 'cards' | 'nodes'

let rightViewMode: DramaRightViewMode = 'cards'
const viewListeners = new Set<() => void>()

/**
 * 右侧视图：卡片（智剧通）或节点画布。
 */
export function getDramaRightViewMode(): DramaRightViewMode {
  return rightViewMode
}

export function setDramaRightViewMode(mode: DramaRightViewMode): void {
  if (rightViewMode === mode) return
  rightViewMode = mode
  viewListeners.forEach((fn) => fn())
}

export function subscribeDramaRightViewMode(listener: () => void): () => void {
  viewListeners.add(listener)
  return () => viewListeners.delete(listener)
}
