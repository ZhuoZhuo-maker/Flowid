import type { NodeWorkflowConfig } from '../types'

/** 节点 data 中与工作流下拉/执行相关的字段 */
export type NodeWorkflowDataPick = {
  model?: string
  workflowEntryId?: string
}

export type MatchStudioNodeWorkflowResult = {
  /** 节点上保存的工作流名称（trim 后） */
  preferredName: string
  /** 按 workflowEntryId 命中的条目 */
  byEntryId: NodeWorkflowConfig['workflows'][number] | undefined
  /** 按 model 名称（含与列表项 trim 对齐）命中的条目 */
  byName: NodeWorkflowConfig['workflows'][number] | undefined
  /** 最终用于组装的条目：workflowEntryId > model 名称 > 设置列表首条（置顶默认，与下拉第一项一致） */
  picked: NodeWorkflowConfig['workflows'][number] | undefined
}

/**
 * 按节点上保存的名称在列表中查找条目：全等 / trim 全等 / 前缀+括号后缀（如「三视图」→「三视图 (1)」）。
 */
export function findWorkflowEntryByPreferredName(
  list: NodeWorkflowConfig['workflows'],
  preferredName: string,
): NodeWorkflowConfig['workflows'][number] | undefined {
  const p = preferredName.trim()
  if (!p || !list.length) return undefined
  const exact =
    list.find((item) => item.name === p) ?? list.find((item) => item.name.trim() === p)
  if (exact) return exact
  const loose = list.filter((item) => {
    const n = item.name.trim()
    return n.startsWith(`${p} (`) || n.startsWith(`${p}（`)
  })
  if (loose.length === 1) return loose[0]
  if (loose.length > 1) {
    return [...loose].sort(
      (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name),
    )[0]
  }
  return undefined
}

/**
 * 将节点上的工作流选择与 `nodeConfigs[kind]` 对齐，供底部面板展示与 `runNodeWorkflow` 共用。
 * 节点未显式选择时（无 id、无 model）：默认使用设置列表**第一条**（置顶工作流），
 * 不使用 `selectedWorkflowId`（该字段表示设置面板里当前正在编辑的条目，易与「画布默认」混淆）。
 */
export function matchStudioNodeWorkflow(
  nodeData: NodeWorkflowDataPick,
  cfg: NodeWorkflowConfig,
): MatchStudioNodeWorkflowResult {
  const list = cfg.workflows
  const preferredName =
    typeof nodeData.model === 'string' ? nodeData.model.trim() : ''
  const entryId =
    typeof nodeData.workflowEntryId === 'string'
      ? nodeData.workflowEntryId.trim()
      : ''
  if (!list.length) {
    return { preferredName, byEntryId: undefined, byName: undefined, picked: undefined }
  }
  const byEntryId = entryId ? list.find((item) => item.id === entryId) : undefined
  const byName = preferredName ? findWorkflowEntryByPreferredName(list, preferredName) : undefined
  const picked = byEntryId ?? byName ?? list[0]
  return { preferredName, byEntryId, byName, picked }
}
