import type { DramaWorkspaceNavTab } from './dramaWorkspaceBridge'
import type { DramaProductionState } from './types'
import { isDramaPhaseAtLeast } from './dramaPhaseUtils'

/** 总览画布节点类型（按制片顺序） */
export type DramaOverviewStage = 'script' | 'character' | 'scene' | 'storyboard' | 'video'

const OVERVIEW_ORDER: DramaOverviewStage[] = ['script', 'character', 'scene', 'storyboard', 'video']

/**
 * 是否已有可展示的剧本正文。
 * @param state 制片状态
 */
export function dramaHasScriptContent(state: DramaProductionState): boolean {
  return state.scriptBody.trim().length >= 40
}

/**
 * 是否已有成片或分镜视频。
 * @param state 制片状态
 */
export function dramaHasVideoContent(state: DramaProductionState): boolean {
  return Boolean(state.finalVideoSrc) || state.shots.some((s) => Boolean(s.videoSrc))
}

/**
 * 某阶段节点是否应在总览画布展示（有数据或已进入对应制片阶段）。
 * @param stage 节点类型
 * @param state 制片状态
 */
function isBoardStageVisible(stage: DramaOverviewStage, state: DramaProductionState): boolean {
  switch (stage) {
    case 'script':
      return dramaHasScriptContent(state)
    case 'character':
      return state.characters.length > 0 || isDramaPhaseAtLeast(state.phase, 'character_location')
    case 'scene':
      return state.locations.length > 0 || isDramaPhaseAtLeast(state.phase, 'storyboard')
    case 'storyboard':
      return state.shots.length > 0 || isDramaPhaseAtLeast(state.phase, 'storyboard')
    case 'video':
      return dramaHasVideoContent(state) || isDramaPhaseAtLeast(state.phase, 'video_audio')
    default:
      return false
  }
}

/**
 * 根据数据与制片阶段决定总览应展示哪些节点。
 * @param state 制片状态
 */
export function listUnlockedOverviewStages(state: DramaProductionState): DramaOverviewStage[] {
  return OVERVIEW_ORDER.filter((s) => isBoardStageVisible(s, state))
}

/**
 * 右侧导航 Tab 是否已解锁（与总览节点可见性一致）。
 * @param tab 导航 Tab
 * @param state 制片状态；null 时仅总览可用
 */
export function isDramaNavTabUnlocked(tab: DramaWorkspaceNavTab, state: DramaProductionState | null): boolean {
  if (tab === 'overview') return true
  if (!state) return false
  if (tab === 'script') return isBoardStageVisible('script', state)
  if (tab === 'character') return isBoardStageVisible('character', state)
  if (tab === 'scene') return isBoardStageVisible('scene', state)
  if (tab === 'storyboard') return isBoardStageVisible('storyboard', state)
  if (tab === 'video') return isBoardStageVisible('video', state)
  return false
}

/**
 * 若当前 Tab 未解锁，回退到最近可用 Tab。
 * @param tab 当前 Tab
 * @param state 制片状态
 */
export function resolveDramaNavTab(tab: DramaWorkspaceNavTab, state: DramaProductionState | null): DramaWorkspaceNavTab {
  if (isDramaNavTabUnlocked(tab, state)) return tab
  if (!state) return 'overview'
  const fallback: DramaWorkspaceNavTab[] = ['video', 'storyboard', 'scene', 'character', 'script', 'overview']
  for (const t of fallback) {
    if (isDramaNavTabUnlocked(t, state)) return t
  }
  return 'overview'
}

/** 总览节点顺序（供 UI 渲染） */
export function dramaOverviewStageOrder(): DramaOverviewStage[] {
  return [...OVERVIEW_ORDER]
}
