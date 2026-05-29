import type { DramaAutoPipelineTrigger } from './dramaAutoPipelineHooks'

/** 短剧各环节生成类型（每环节独立选择 Comfy 工作流或云端） */
export type DramaGenStage =
  | 'character_design'
  | 'character_concept'
  | 'scene'
  | 'storyboard_image'
  | 'storyboard_video'
  | 'music'
  | 'composite'

/** 环节中文说明 */
export const DRAMA_STAGE_LABELS: Record<DramaGenStage, string> = {
  character_design: '角色设计图（提示词生图）',
  character_concept: '角色概念图（设计图 + 提示词 · 三视图）',
  scene: '场景图（提示词生图）',
  storyboard_image: '分镜图（角色概念 + 场景 + 提示词 · 九宫格）',
  storyboard_video: '分镜视频（九宫格 + 提示词生视频）',
  music: '背景音乐（剧情提示词生音乐）',
  composite: '成片合成（预览最终视频）',
}

/** 云端选项文案（各环节通用） */
export const DRAMA_STAGE_CLOUD_OPTION = '云端 Image3 模型'

/**
 * 环节对应的 Studio 节点类型（用于读取工作流列表）。
 * @param stage 制片环节
 */
export function dramaStageNodeKind(stage: DramaGenStage): 'image' | 'video' | 'music' {
  if (stage === 'storyboard_video' || stage === 'composite') return 'video'
  if (stage === 'music') return 'music'
  return 'image'
}

/**
 * 流水线触发点 → 默认待选环节。
 * @param trigger 触发点
 */
export function dramaTriggerToGenStage(trigger: DramaAutoPipelineTrigger): DramaGenStage {
  switch (trigger) {
    case 'characters_written':
    case 'locations_written':
      return 'character_design'
    case 'character_images_done':
      return 'scene'
    case 'shots_written':
      return 'storyboard_image'
    case 'storyboard_images_done':
      return 'storyboard_video'
    case 'scene_main_done':
    case 'scene_multiview_done':
      return 'storyboard_image'
    default:
      return 'character_design'
  }
}
