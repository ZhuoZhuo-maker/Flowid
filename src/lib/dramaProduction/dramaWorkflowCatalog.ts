import type { NodeWorkflowConfig } from '../../types'
import type { DramaGenStage } from './dramaGenStages'
import { dramaStageNodeKind } from './dramaGenStages'

export type DramaWorkflowEntry = { id: string; name: string }

type CatalogProvider = {
  getNodeConfig: (kind: 'image' | 'video' | 'music') => NodeWorkflowConfig
}

let catalogProvider: CatalogProvider | null = null

/**
 * 注册工作流目录（由 StudioApp 在 nodeConfigs 就绪后注入）。
 * @param provider 读取 image / video / music 工作流列表
 */
export function registerDramaWorkflowCatalog(provider: CatalogProvider): void {
  catalogProvider = provider
}

/**
 * 读取某环节可选的 ComfyUI 本地工作流（设置面板列表顺序，首条为默认置顶）。
 * @param stage 制片环节
 */
export function listDramaWorkflowsForStage(stage: DramaGenStage): DramaWorkflowEntry[] {
  if (!catalogProvider) return []
  const kind = dramaStageNodeKind(stage)
  const list = catalogProvider.getNodeConfig(kind).workflows ?? []
  return list
    .map((w) => ({ id: String(w.id || '').trim(), name: String(w.name || '').trim() }))
    .filter((w) => w.id && w.name)
}

/**
 * 按名称解析工作流条目。
 * @param stage 环节
 * @param name 工作流名称
 */
export function findDramaWorkflowByName(stage: DramaGenStage, name: string): DramaWorkflowEntry | null {
  const n = name.trim()
  if (!n) return null
  const hit =
    listDramaWorkflowsForStage(stage).find((w) => w.name === n) ??
    listDramaWorkflowsForStage(stage).find((w) => w.name.trim() === n)
  return hit ?? null
}

/**
 * 当前环节默认工作流（列表第一条，与 Studio 图片节点下拉默认一致）。
 * @param stage 环节
 */
export function getDefaultDramaWorkflowForStage(stage: DramaGenStage): DramaWorkflowEntry | null {
  const list = listDramaWorkflowsForStage(stage)
  return list[0] ?? null
}
