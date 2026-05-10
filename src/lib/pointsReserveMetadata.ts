import type { Node } from '@xyflow/react'
import { matchStudioNodeWorkflow } from './matchStudioNodeWorkflow'
import type { WorkflowConfigSnapshot } from './workflowConfigStorage'
import type { StudioNodeData, StudioNodeKind } from '../types'

export type PointsBillingKind = 'cloud_model' | 'cloud_workflow' | 'local_workflow'

export type PointsReserveParams = {
  nodeKind: StudioNodeKind
  executionTarget: 'model' | 'workflow'
  metadata: {
    cloudModelName?: string
    workflowName?: string
    /** 云端 OpenAI 兼容调用为 cloud_model；云端 Comfy 为 cloud_workflow；本地 Comfy 为 local_workflow（0 积分） */
    pointsBillingKind?: PointsBillingKind
  }
}

/**
 * 与 `useWorkflowIntegration` 中 `runNodeWorkflow` 预扣参数一致，供 /quote 与节点角标展示。
 */
export function buildPointsReserveParams(
  node: Node<StudioNodeData>,
  snapshot: WorkflowConfigSnapshot,
  options?: { executionTarget?: 'model' | 'workflow' },
): PointsReserveParams {
  const nodeKind = node.data.kind
  if (nodeKind === 'group' || nodeKind === 'panorama' || nodeKind === 'imageCompare') {
    throw new Error('unsupported_node_kind')
  }
  const nodeConfig = snapshot.nodeConfigs[nodeKind]
  const hasCloudModelConfigured =
    Boolean(String(nodeConfig.cloudModelUrl || '').trim()) &&
    Boolean(String(nodeConfig.cloudModelName || '').trim())
  const executionTarget =
    options?.executionTarget ??
    ((node.data as { promptPickerMode?: string }).promptPickerMode === 'model' ? 'model' : undefined) ??
    (!snapshot.local.enabled && !snapshot.cloud.enabled && hasCloudModelConfigured ? 'model' : 'workflow')

  const { picked } = matchStudioNodeWorkflow(
    node.data as { model?: string; workflowEntryId?: string },
    nodeConfig,
  )
  /** 云端 + 自定义：节点下拉写入的显示名在 `model` 字段，须优先于本地 workflows 的 picked，才能与后台 workflow:{slug} 一致 */
  const preferNodeModelForCloudWfSlug =
    snapshot.executionProvider === 'cloud' &&
    snapshot.executionMode === 'custom' &&
    executionTarget !== 'model'
  const workflowName = String(
    preferNodeModelForCloudWfSlug
      ? (node.data as { model?: string }).model || picked?.name || ''
      : picked?.name || (node.data as { model?: string }).model || '',
  ).trim()
  let pointsBillingKind: PointsBillingKind =
    executionTarget === 'model' ? 'cloud_model' : snapshot.executionProvider === 'cloud' ? 'cloud_workflow' : 'local_workflow'

  let cloudModelName = ''
  if (executionTarget === 'model') {
    const nodeModelPre = String(
      (node.data as { cloudModelName?: string }).cloudModelName || nodeConfig.cloudModelName || '',
    ).trim()
    let selfModel = ''
    try {
      const listRaw = window.localStorage.getItem('flowid.cloud.self.presets.v1')
      const activeId = String(window.localStorage.getItem('flowid.cloud.self.activePresetId.v1') || '').trim()
      const list = listRaw ? (JSON.parse(listRaw) as unknown[]) : []
      const normalized = Array.isArray(list) ? list : []
      const byNodeKind = normalized.filter((x) => {
        const nk = String((x as { nodeKind?: string })?.nodeKind || '').trim()
        return !nk || nk === nodeKind
      })
      const hit =
        (activeId ? byNodeKind.find((x) => String((x as { id?: string })?.id || '') === activeId) : null) ||
        byNodeKind[0] ||
        (activeId ? normalized.find((x) => String((x as { id?: string })?.id || '') === activeId) : null) ||
        normalized[0] ||
        null
      selfModel = String((hit as { model?: string })?.model || '').trim()
    } catch {
      selfModel = ''
    }
    cloudModelName = (nodeModelPre || selfModel).trim()
  }

  return {
    nodeKind,
    executionTarget: executionTarget === 'model' ? 'model' : 'workflow',
    metadata: {
      cloudModelName: cloudModelName || undefined,
      workflowName: workflowName || undefined,
      pointsBillingKind,
    },
  }
}
