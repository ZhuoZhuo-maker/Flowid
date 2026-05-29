import type { DramaProductionPhase } from './types'

/** 短剧制片阶段中文标签 */
export const DRAMA_PHASE_LABELS: Record<DramaProductionPhase, string> = {
  intake: '确认参数',
  script_draft: '撰写剧本',
  character_location: '角色与场景',
  compliance_review: '审核优化',
  storyboard: '拆分分镜',
  storyboard_images: '镜头出图',
  video_audio: '视频与配音',
  export: '导出成片',
  done: '已完成',
}

/** 标准推进顺序 */
export const DRAMA_PHASE_ORDER: DramaProductionPhase[] = [
  'intake',
  'script_draft',
  'character_location',
  'compliance_review',
  'storyboard',
  'storyboard_images',
  'video_audio',
  'export',
  'done',
]

/**
 * 进入下一阶段
 * @param current 当前阶段
 */
export function advanceDramaPhase(current: DramaProductionPhase): DramaProductionPhase {
  const idx = DRAMA_PHASE_ORDER.indexOf(current)
  if (idx < 0 || idx >= DRAMA_PHASE_ORDER.length - 1) return current
  return DRAMA_PHASE_ORDER[idx + 1]!
}

/**
 * 回退上一阶段
 * @param current 当前阶段
 */
export function retreatDramaPhase(current: DramaProductionPhase): DramaProductionPhase {
  const idx = DRAMA_PHASE_ORDER.indexOf(current)
  if (idx <= 0) return current
  return DRAMA_PHASE_ORDER[idx - 1]!
}
