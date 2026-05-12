import type { CloudWorkflowMeta } from './cloudWorkflowsApi'
import { matchStudioNodeWorkflow } from './matchStudioNodeWorkflow'
import { resolvedPromptPickerMode } from './promptPickerMode'
import type { ImageNodeData, NodeWorkflowConfig, StudioNodeKind, VideoNodeData } from '../types'

/** 与 `useWorkflowIntegration` 注入逻辑一致：占位符或 Qwen Multiangle 节点任一命中即视为支持 */
export function workflowJsonUsesMultiangleCamPlaceholders(jsonText: string): boolean {
  const s = String(jsonText ?? '')
  if (s.includes('__CAM_H__') && s.includes('__CAM_V__') && s.includes('__CAM_Z__')) return true
  return s.includes('QwenMultiangleCameraNode')
}

/** 列表元数据缺少 `supportsMultiangle`（旧版授权服务）时，用显示名兜底 */
export function workflowNameSuggestsMultiangle(name: string): boolean {
  const n = String(name || '')
  return /角度控制/.test(n) || /\bmultiangle\b/i.test(n) || /QwenMultiangle/i.test(n)
}

/**
 * 当前节点在「工作流」模式下选中的模板是否会消费 Multiangle 占位符。
 * 云端模型模式、或非 Multiangle 模板时返回 false。
 */
export function nodeSupportsMultiangleAngleControl(opts: {
  kind: 'image' | 'video'
  nodeData: ImageNodeData | VideoNodeData
  executionProvider: string
  cloudWorkflowMetaList: CloudWorkflowMeta[]
  nodeConfigs: Record<StudioNodeKind, NodeWorkflowConfig>
}): boolean {
  const mode = resolvedPromptPickerMode(opts.nodeData)
  if (mode === 'model') return false

  if (opts.executionProvider === 'cloud') {
    const filtered = opts.cloudWorkflowMetaList.filter((w) => !w.nodeKind || w.nodeKind === opts.kind)
    const eid = String(opts.nodeData.workflowEntryId || '').trim()
    let hit = eid ? filtered.find((w) => w.id === eid) : undefined
    if (!hit) {
      const modelTrim = String(opts.nodeData.model || '').trim()
      if (modelTrim) {
        hit =
          filtered.find((w) => w.name === modelTrim) ??
          filtered.find((w) => w.name.trim() === modelTrim)
      }
    }
    if (!hit) hit = filtered[0]
    if (!hit) return false
    if (hit.supportsMultiangle === true) return true
    if (hit.supportsMultiangle === false) return false
    return workflowNameSuggestsMultiangle(hit.name)
  }

  const cfg = opts.nodeConfigs[opts.kind]
  const { picked } = matchStudioNodeWorkflow(
    {
      model: opts.nodeData.model,
      workflowEntryId: opts.nodeData.workflowEntryId,
    },
    cfg,
  )
  if (!picked) return false
  if (workflowJsonUsesMultiangleCamPlaceholders(picked.jsonText ?? '')) return true
  return workflowNameSuggestsMultiangle(picked.name)
}
