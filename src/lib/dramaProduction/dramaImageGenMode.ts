import {
  encodeCloudAssistModelPick,
  fetchCloudAssistModelCatalog,
  getAssistApiKey,
} from '../cloudAssistModelCatalog'
import type { ImageNodeData } from '../../types'
import type { DramaGenStage } from './dramaGenStages'
import { dramaStageNodeKind } from './dramaGenStages'
import { getDefaultDramaWorkflowForStage } from './dramaWorkflowCatalog'
import { getDramaStageGenChoice, getDramaUiState, type DramaImageGenMode } from './dramaUiBridge'

/**
 * 为短剧某环节构建节点执行 patch（Comfy 指定工作流 / 云端 image2）。
 * @param projectTabId 项目 id
 * @param stage 制片环节
 */
export async function buildDramaNodeExecPatchForStage(
  projectTabId: string,
  stage: DramaGenStage,
): Promise<Partial<ImageNodeData>> {
  const choice = getDramaStageGenChoice(projectTabId, stage)
  const mode: DramaImageGenMode = choice?.mode ?? getDramaUiState(projectTabId).imageGenMode ?? 'workflow'

  if (mode === 'workflow') {
    const wf =
      choice?.workflowEntryId && choice.workflowName
        ? { id: choice.workflowEntryId, name: choice.workflowName }
        : getDefaultDramaWorkflowForStage(stage)
    return {
      promptPickerMode: 'workflow',
      ...(wf
        ? { workflowEntryId: wf.id, model: wf.name }
        : {}),
    }
  }

  const kind = dramaStageNodeKind(stage)
  if (kind === 'video') {
    return { promptPickerMode: 'workflow' }
  }

  try {
    const catalog = await fetchCloudAssistModelCatalog()
    for (const ep of catalog.kinds.image) {
      const model =
        ep.models.find((m) => /gpt-image-2|image-3|image3/i.test(m)) ||
        ep.models.find((m) => /image/i.test(m)) ||
        ep.models[0]
      if (!model) continue
      return {
        promptPickerMode: 'model',
        cloudAssistModelPick: encodeCloudAssistModelPick(ep.id, model),
        cloudModelName: model,
        cloudModelUrl: ep.baseUrl,
        cloudApiKey: getAssistApiKey('image'),
      }
    }
  } catch {
    /* 无云端配置时仍标记为 model，由画布执行层兜底 */
  }
  return { promptPickerMode: 'model', cloudModelName: 'gpt-image-2' }
}

/**
 * @deprecated 使用 buildDramaNodeExecPatchForStage
 */
export async function buildDramaImageNodeExecPatch(
  mode: DramaImageGenMode,
): Promise<Partial<ImageNodeData>> {
  if (mode === 'workflow') {
    return { promptPickerMode: 'workflow' }
  }
  try {
    const catalog = await fetchCloudAssistModelCatalog()
    for (const ep of catalog.kinds.image) {
      const model =
        ep.models.find((m) => /gpt-image-2/i.test(m)) ||
        ep.models.find((m) => /image/i.test(m)) ||
        ep.models[0]
      if (!model) continue
      return {
        promptPickerMode: 'model',
        cloudAssistModelPick: encodeCloudAssistModelPick(ep.id, model),
        cloudModelName: model,
        cloudModelUrl: ep.baseUrl,
        cloudApiKey: getAssistApiKey('image'),
      }
    }
  } catch {
    /* ignore */
  }
  return { promptPickerMode: 'model', cloudModelName: 'gpt-image-2' }
}

/**
 * 当前环节将使用的 Comfy 工作流名称（用于日志 / 提示）。
 * @param projectTabId 项目 id
 * @param stage 环节
 */
export function describeDramaStageWorkflow(projectTabId: string, stage: DramaGenStage): string {
  const choice = getDramaStageGenChoice(projectTabId, stage)
  if (choice?.mode === 'cloud') return '云端 Image3'
  if (choice?.workflowName) return choice.workflowName
  return getDefaultDramaWorkflowForStage(stage)?.name ?? '（设置列表首条工作流）'
}
