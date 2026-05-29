/**
 * 短剧 ask_user：Agent 向用户提问时，聊天窗展示选项卡片。
 */

export type DramaAskUserKind =
  | 'params'
  | 'keywords'
  | 'satisfaction'
  | 'visual_style'
  | 'scene_style'
  | 'character_satisfaction'
  | 'scene_main_satisfaction'
  | 'scene_multiview_satisfaction'
  | 'storyboard_plan'
  | 'storyboard_image_satisfaction'
  | 'storyboard_video_prompt_satisfaction'
  | 'storyboard_video_satisfaction'
  | 'image_gen_mode'
  | 'stage_gen_choice'
  | 'generic'

export type DramaAskUserPayload = {
  question: string
  options: string[]
  expertRole?: string
  /** 卡片类型：参数 / 情绪关键词 / 满意度 / 通用 */
  kind?: DramaAskUserKind
  /** 环节工作流选择：对应制片阶段 */
  stage?: import('./dramaGenStages').DramaGenStage
}

let pending: DramaAskUserPayload | null = null
const listeners = new Set<() => void>()

/**
 * @param payload 待用户回答的提问；传 null 清除
 */
export function setDramaAskUserPending(payload: DramaAskUserPayload | null): void {
  pending = payload
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

/** 读取当前待回答提问 */
export function getDramaAskUserPending(): DramaAskUserPayload | null {
  return pending
}

/** 订阅 ask_user 变化（供 Agent 聊天 UI） */
export function subscribeDramaAskUser(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
