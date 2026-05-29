import type { DramaAutoPipelineTrigger } from './dramaAutoPipelineHooks'
import type { DramaImageGenMode } from './dramaUiBridge'
import {
  ensureDramaStageGenChoiceForTrigger,
  inferDramaPipelineTriggerFromState,
  isDramaStageGenChoiceAsk,
  rememberDramaStageGenAsk,
  resumeDramaPipelineAfterStageGenChoice,
} from './dramaStageGenChoice'
import { dramaTriggerToGenStage } from './dramaGenStages'
import type { DramaGenStage } from './dramaGenStages'

/** @deprecated 兼容旧 UI 文案 */
export const DRAMA_IMAGE_GEN_MODE_OPTION_COMFY = 'ComfyUI 本地工作流'
export const DRAMA_IMAGE_GEN_MODE_OPTION_CLOUD = '云端 Image3 模型'

export {
  ensureDramaStageGenChoiceForTrigger as ensureDramaImageGenModeOrPrompt,
  inferDramaPipelineTriggerFromState,
  isDramaStageGenChoiceAsk as isDramaImageGenModeAsk,
  resumeDramaPipelineAfterStageGenChoice as resumeDramaPipelineAfterImageGenModeChoice,
}

/**
 * 解析用户选项为出图模式（云端 / 本地工作流意图）。
 * @param text 用户点击的选项或输入
 */
export function parseDramaImageGenModeFromChoice(text: string): DramaImageGenMode | null {
  const t = text.trim()
  if (/ComfyUI|Comfy|本地工作流|文生图/i.test(t)) return 'workflow'
  if (/云端|image\s*\d|image-?\d|image2|image3|模型/i.test(t)) return 'cloud'
  return null
}

/**
 * Agent 工具名 → 流水线续跑触发点。
 * @param toolName 工具名
 */
export function dramaImageGenToolToPipelineTrigger(toolName: string): DramaAutoPipelineTrigger | null {
  switch (toolName) {
    case 'flowid_drama_generate_character_images':
      return 'characters_written'
    case 'flowid_drama_generate_scene_images':
      return 'character_images_done'
    case 'flowid_drama_generate_storyboard_images':
      return 'shots_written'
    default:
      return null
  }
}

/** @deprecated 使用 ensureDramaStageGenChoiceForTrigger */
export function isDramaImageGenModeChosen(_projectTabId: string): boolean {
  return false
}

/** @deprecated */
export function promptDramaImageGenModeChoice(
  projectTabId: string,
  resumeTrigger: DramaAutoPipelineTrigger,
): void {
  ensureDramaStageGenChoiceForTrigger(projectTabId, resumeTrigger)
}

/** @deprecated */
export function confirmDramaImageGenMode(projectTabId: string, _mode: DramaImageGenMode): void {
  resumeDramaPipelineAfterStageGenChoice(projectTabId)
}

/** 工具 handler 识别环节 ask 时写入 pending */
export function rememberDramaPipelineTriggerForImageGenAsk(
  projectTabId: string,
  trigger: DramaAutoPipelineTrigger,
): void {
  rememberDramaStageGenAsk(projectTabId, dramaTriggerToGenStage(trigger), trigger)
}

export type { DramaGenStage }
