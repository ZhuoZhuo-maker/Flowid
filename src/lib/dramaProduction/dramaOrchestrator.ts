/**
 * 短剧多 Agent 编排：阶段 / 状态 → 当前活跃专家，及 handover 同步。
 */

import type { DramaAgentPersonaId } from './dramaAgentPersonas'
import { pushDramaHandover } from './dramaChatEventsBridge'
import { patchDramaProductionState, ensureDramaProductionState } from './dramaStateStore'
import type { DramaProductionState } from './types'

/**
 * 根据制片阶段与数据进度推断当前应活跃的专家。
 * @param state 制片状态
 */
export function resolveActiveExpertForState(state: DramaProductionState): DramaAgentPersonaId {
  if (state.activeExpertId) return state.activeExpertId

  const { phase, characters, locations } = state

  switch (phase) {
    case 'intake':
    case 'compliance_review':
    case 'export':
    case 'done':
      return 'art_director'
    case 'script_draft':
      return 'screenwriter'
    case 'character_location':
      if (characters.length > 0 && locations.length === 0) return 'scene_designer'
      return 'character_designer'
    case 'storyboard':
    case 'storyboard_images':
    case 'video_audio':
      return 'storyboard_designer'
    default:
      return 'art_director'
  }
}

/**
 * 若专家发生变化，写入 handover 并更新 activeExpertId。
 * @param projectTabId 项目 id
 * @param nextExpert 目标专家
 * @returns 是否发生切换
 */
export function applyDramaExpertHandover(
  projectTabId: string,
  nextExpert: DramaAgentPersonaId,
): boolean {
  if (!projectTabId) return false
  const state = ensureDramaProductionState(projectTabId)
  const prevExpert = resolveActiveExpertForState(state)
  if (prevExpert === nextExpert) {
    patchDramaProductionState(projectTabId, { activeExpertId: nextExpert })
    return false
  }
  pushDramaHandover(projectTabId, prevExpert, nextExpert)
  patchDramaProductionState(projectTabId, { activeExpertId: nextExpert })
  return true
}

/**
 * 阶段变更后清除手动指定专家，按新阶段重新解析并 handover。
 * @param projectTabId 项目 id
 * @param nextState 已写入新 phase 的状态（activeExpertId 应为 undefined）
 */
export function syncDramaExpertAfterPhaseChange(
  projectTabId: string,
  prevState: DramaProductionState,
  nextState: DramaProductionState,
): void {
  const prevExpert = resolveActiveExpertForState(prevState)
  const nextExpert = resolveActiveExpertForState(nextState)
  if (prevExpert !== nextExpert) {
    pushDramaHandover(projectTabId, prevExpert, nextExpert)
    patchDramaProductionState(projectTabId, { activeExpertId: nextExpert })
  }
}

/** 合法专家 id 列表 */
export const DRAMA_EXPERT_IDS: DramaAgentPersonaId[] = [
  'art_director',
  'screenwriter',
  'character_designer',
  'scene_designer',
  'storyboard_designer',
]

/**
 * 解析工具参数中的专家 id。
 * @param raw 模型传入字符串
 */
export function parseDramaExpertId(raw: string): DramaAgentPersonaId | null {
  const s = raw.trim().toLowerCase()
  if (DRAMA_EXPERT_IDS.includes(s as DramaAgentPersonaId)) return s as DramaAgentPersonaId
  if (/艺术总监|art.?director/i.test(raw)) return 'art_director'
  if (/编剧|screenwriter/i.test(raw)) return 'screenwriter'
  if (/角色|character/i.test(raw)) return 'character_designer'
  if (/场景|scene/i.test(raw)) return 'scene_designer'
  if (/分镜|storyboard/i.test(raw)) return 'storyboard_designer'
  return null
}
