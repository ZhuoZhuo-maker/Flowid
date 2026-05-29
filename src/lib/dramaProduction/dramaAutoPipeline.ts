import { loadDramaProductionState, patchDramaProductionState } from './dramaStateStore'
import { getDramaUiState, isDramaAutoPilot } from './dramaUiBridge'
import {
  runDramaCharacterImageGeneration,
  runDramaSceneImageGeneration,
  type DramaImageRunDeps,
} from './dramaImageGeneration'
import {
  runDramaStoryboardImageGeneration,
  runDramaStoryboardVideoGeneration,
  type DramaStoryboardRunDeps,
} from './dramaStoryboardGeneration'
import { applyDramaExpertHandover, syncDramaExpertAfterPhaseChange } from './dramaOrchestrator'
import { pushDramaChatStep } from './dramaChatStepsBridge'
import { syncDramaNavFromCanvasFocus } from './dramaWorkspaceBridge'
import type { DramaAutoPipelineTrigger } from './dramaAutoPipelineHooks'
import { setDramaAutoPipelineHook, setDramaAutoPipelineScheduler } from './dramaAutoPipelineHooks'
import { ensureDramaStageGenChoiceForTrigger } from './dramaStageGenChoice'

/** 自动流水线所需依赖（与 DramaToolHandlerDeps 对齐，避免循环引用） */
export type DramaPipelineDeps = DramaImageRunDeps & DramaStoryboardRunDeps & {
  appendHistory: (label: string) => void
}

/** 自动制片流水线触发点（见 dramaAutoPipelineHooks） */
export type { DramaAutoPipelineTrigger } from './dramaAutoPipelineHooks'

let pipelineDeps: DramaPipelineDeps | null = null
const runningByProject = new Set<string>()

/**
 * 注册工具依赖（每次 handleDramaAgentTool 调用时刷新）。
 * @param deps 工具依赖
 */
export function registerDramaPipelineDeps(deps: DramaPipelineDeps): void {
  pipelineDeps = deps
}

function asImageDeps(deps: DramaPipelineDeps): DramaImageRunDeps {
  return deps
}

function asStoryboardDeps(deps: DramaPipelineDeps): DramaStoryboardRunDeps {
  return deps
}

function charactersNeedImages(tabId: string): boolean {
  const state = loadDramaProductionState(tabId)
  if (!state?.characters.length) return false
  return state.characters.some((c) => !c.designImageSrc?.trim() || !c.imageSrc?.trim())
}

function sceneNeedsMainImage(tabId: string): boolean {
  const state = loadDramaProductionState(tabId)
  const loc = state?.locations[0]
  if (!loc) return false
  return !loc.mainImageSrc?.trim()
}

function shotsNeedImages(tabId: string): boolean {
  const state = loadDramaProductionState(tabId)
  if (!state?.shots.length) return false
  return state.shots.some((s) => !(s.imageSrcs?.length ?? 0))
}

function shotsNeedVideos(tabId: string): boolean {
  const state = loadDramaProductionState(tabId)
  if (!state?.shots.length) return false
  return state.shots.some((s) => !s.videoSrc?.trim())
}

/**
 * 角色与场景主图就绪后进入分镜阶段。
 * @param tabId 项目 id
 * @param deps 工具依赖
 */
function advanceToStoryboardWhenAssetsReady(tabId: string, deps: DramaPipelineDeps): void {
  const state = loadDramaProductionState(tabId)
  if (!state || state.phase !== 'character_location') return
  if (state.characters.length === 0 || state.locations.length === 0) return
  if (charactersNeedImages(tabId) || sceneNeedsMainImage(tabId)) return

  const prev = state
  const next = patchDramaProductionState(tabId, { phase: 'storyboard', activeExpertId: undefined })
  syncDramaExpertAfterPhaseChange(tabId, prev, next)
  applyDramaExpertHandover(tabId, 'storyboard_designer')
  syncDramaNavFromCanvasFocus('storyboard')
  deps.appendHistory('短剧 Agent：角色与场景图已完成，进入分镜阶段')
  pushDramaChatStep(tabId, '推进制片阶段')
  pushDramaChatStep(tabId, '邀请专家加入群聊')
}

/**
 * 调度自动制片下一步（后台异步，不阻塞工具返回）。
 * @param tabId 项目 id
 * @param trigger 触发点
 */
export function scheduleDramaAutoPipeline(tabId: string, trigger: import('./dramaAutoPipelineHooks').DramaAutoPipelineTrigger): void {
  if (!tabId || !isDramaAutoPilot(tabId) || !pipelineDeps) return
  if (runningByProject.has(tabId)) return
  runningByProject.add(tabId)
  void runDramaAutoPipeline(tabId, pipelineDeps, trigger).finally(() => {
    runningByProject.delete(tabId)
  })
}

/**
 * @param tabId 项目 id
 * @param deps 工具依赖
 * @param trigger 触发点
 */
async function runDramaAutoPipeline(
  tabId: string,
  deps: DramaPipelineDeps,
  trigger: DramaAutoPipelineTrigger,
): Promise<void> {
  if (!isDramaAutoPilot(tabId)) return

  const imgDeps = asImageDeps(deps)
  const sbDeps = asStoryboardDeps(deps)
  const state = loadDramaProductionState(tabId)
  if (!state) return

  try {
    if (
      (trigger === 'characters_written' || trigger === 'locations_written') &&
      charactersNeedImages(tabId) &&
      imgDeps
    ) {
      if (ensureDramaStageGenChoiceForTrigger(tabId, trigger)) return
      const style = state.spec.visualStyle || getDramaUiState(tabId).selectedVisualStyle || undefined
      await runDramaCharacterImageGeneration(imgDeps, style)
      return
    }

    if (
      (trigger === 'characters_written' ||
        trigger === 'locations_written' ||
        trigger === 'character_images_done') &&
      !charactersNeedImages(tabId) &&
      sceneNeedsMainImage(tabId) &&
      imgDeps
    ) {
      if (ensureDramaStageGenChoiceForTrigger(tabId, 'character_images_done')) return
      await runDramaSceneImageGeneration(imgDeps, 'main')
      return
    }

    if (trigger === 'scene_main_done') {
      advanceToStoryboardWhenAssetsReady(tabId, deps)
      const after = loadDramaProductionState(tabId)
      if (after?.phase === 'storyboard' && after.shots.length > 0 && shotsNeedImages(tabId) && sbDeps) {
        if (ensureDramaStageGenChoiceForTrigger(tabId, 'shots_written')) return
        await runDramaStoryboardImageGeneration(sbDeps)
      }
      return
    }

    if (trigger === 'scene_multiview_done') {
      advanceToStoryboardWhenAssetsReady(tabId, deps)
      return
    }

    if (trigger === 'shots_written' && sbDeps && state.shots.length > 0 && shotsNeedImages(tabId)) {
      if (ensureDramaStageGenChoiceForTrigger(tabId, trigger)) return
      await runDramaStoryboardImageGeneration(sbDeps)
      return
    }

    if (trigger === 'storyboard_images_done' && sbDeps && shotsNeedVideos(tabId)) {
      await runDramaStoryboardVideoGeneration(sbDeps)
      return
    }

    if (trigger === 'character_images_done' || trigger === 'locations_written') {
      advanceToStoryboardWhenAssetsReady(tabId, deps)
    }
  } catch (e) {
    deps.appendHistory(`短剧 Agent 自动制片：${(e as Error)?.message || String(e)}`)
  }
}

setDramaAutoPipelineHook((tabId, trigger) => {
  scheduleDramaAutoPipeline(tabId, trigger)
})

setDramaAutoPipelineScheduler((tabId, trigger) => {
  scheduleDramaAutoPipeline(tabId, trigger)
})
