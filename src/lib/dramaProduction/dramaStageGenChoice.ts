import { loadDramaProductionState } from './dramaStateStore'
import { setDramaAskUserPending } from './dramaAskUserBridge'
import type { DramaAutoPipelineTrigger } from './dramaAutoPipelineHooks'
import { resumeDramaAutoPipeline } from './dramaAutoPipelineHooks'
import {
  DRAMA_STAGE_CLOUD_OPTION,
  DRAMA_STAGE_LABELS,
  type DramaGenStage,
  dramaTriggerToGenStage,
} from './dramaGenStages'
import {
  findDramaWorkflowByName,
  getDefaultDramaWorkflowForStage,
  listDramaWorkflowsForStage,
} from './dramaWorkflowCatalog'
import {
  getDramaStageGenChoice,
  setDramaStageGenChoice,
  type DramaImageGenMode,
} from './dramaUiBridge'
import { parseDramaImageGenModeFromChoice } from './dramaImageGenModeChoice'

type PendingStageAsk = { stage: DramaGenStage; trigger: DramaAutoPipelineTrigger }
const pendingByProject = new Map<string, PendingStageAsk>()

/**
 * 用户是否已为该环节选择过工作流。
 * @param projectTabId 项目 id
 * @param stage 环节
 */
export function isDramaStageGenChoiceDone(projectTabId: string, stage: DramaGenStage): boolean {
  return Boolean(getDramaStageGenChoice(projectTabId, stage))
}

/**
 * 在对话中弹出该环节的工作流选择（本地工作流列表 + 云端）。
 * @param projectTabId 项目 id
 * @param stage 环节
 * @param resumeTrigger 用户选择后续跑触发点
 */
export function promptDramaStageGenChoice(
  projectTabId: string,
  stage: DramaGenStage,
  resumeTrigger: DramaAutoPipelineTrigger,
): void {
  if (!projectTabId) return
  pendingByProject.set(projectTabId, { stage, trigger: resumeTrigger })
  const workflows = listDramaWorkflowsForStage(stage)
  const wfNames = workflows.map((w) => w.name)
  const defaultWf = getDefaultDramaWorkflowForStage(stage)
  const hint = defaultWf
    ? `（未选时 Comfy 默认：${defaultWf.name}）`
    : '（请先在设置 → 图片/视频/音乐 中配置 ComfyUI 工作流）'
  setDramaAskUserPending({
    kind: 'stage_gen_choice',
    stage,
    question: `${DRAMA_STAGE_LABELS[stage]}：请选择生成工作流 ${hint}`,
    options: wfNames.length ? [...wfNames, DRAMA_STAGE_CLOUD_OPTION] : [DRAMA_STAGE_CLOUD_OPTION],
    expertRole: '艺术总监',
  })
}

/**
 * 解析用户点选：云端或具体工作流名称。
 * @param stage 环节
 * @param text 选项文案
 */
export function parseDramaStageGenChoiceFromText(
  stage: DramaGenStage,
  text: string,
): { mode: DramaImageGenMode; workflowEntryId?: string; workflowName?: string } | null {
  const t = text.trim()
  const cloud = parseDramaImageGenModeFromChoice(t)
  if (cloud === 'cloud') return { mode: 'cloud' }
  const wf = findDramaWorkflowByName(stage, t)
  if (wf) return { mode: 'workflow', workflowEntryId: wf.id, workflowName: wf.name }
  if (cloud === 'workflow') {
    const def = getDefaultDramaWorkflowForStage(stage)
    if (def) return { mode: 'workflow', workflowEntryId: def.id, workflowName: def.name }
  }
  return null
}

/**
 * 记录 Agent ask 时的环节与续跑点。
 * @param projectTabId 项目 id
 * @param stage 环节
 * @param trigger 触发点
 */
export function rememberDramaStageGenAsk(
  projectTabId: string,
  stage: DramaGenStage,
  trigger: DramaAutoPipelineTrigger,
): void {
  pendingByProject.set(projectTabId, { stage, trigger })
}

/**
 * 确认环节工作流选择。
 * @param projectTabId 项目 id
 * @param stage 环节
 * @param parsed 解析结果
 */
export function confirmDramaStageGenChoice(
  projectTabId: string,
  stage: DramaGenStage,
  parsed: { mode: DramaImageGenMode; workflowEntryId?: string; workflowName?: string },
): void {
  setDramaStageGenChoice(projectTabId, stage, { ...parsed, chosen: true })
}

/**
 * 用户选完工作流后续跑流水线。
 * @param projectTabId 项目 id
 */
export function resumeDramaPipelineAfterStageGenChoice(projectTabId: string): void {
  const pending = pendingByProject.get(projectTabId)
  pendingByProject.delete(projectTabId)
  const trigger = pending?.trigger ?? inferDramaPipelineTriggerFromState(projectTabId)
  resumeDramaAutoPipeline(projectTabId, trigger)
}

/**
 * 根据制片数据推断续跑触发点。
 * @param projectTabId 项目 id
 */
export function inferDramaPipelineTriggerFromState(projectTabId: string): DramaAutoPipelineTrigger {
  const state = loadDramaProductionState(projectTabId)
  if (!state) return 'characters_written'
  if (state.characters.some((c) => !c.designImageSrc?.trim())) return 'characters_written'
  if (state.characters.some((c) => !c.imageSrc?.trim())) return 'characters_written'
  const loc = state.locations[0]
  if (loc && !loc.mainImageSrc?.trim()) return 'character_images_done'
  if (state.shots.length > 0 && state.shots.some((s) => !(s.imageSrcs?.length ?? 0))) {
    return 'shots_written'
  }
  if (state.shots.some((s) => !s.videoSrc?.trim())) return 'storyboard_images_done'
  return 'characters_written'
}

/**
 * 是否为环节工作流选择 ask。
 * @param question 提问
 * @param options 选项
 */
export function isDramaStageGenChoiceAsk(question: string, options: string[]): boolean {
  if (/请选择生成工作流|角色设计图|角色概念图|场景图|分镜图|分镜视频|背景音乐|成片合成/.test(question)) {
    return true
  }
  const hasCloud = options.some((o) => /云端|image/i.test(o))
  const hasWf = options.some((o) => !/云端|image\s*\d/i.test(o))
  return hasCloud && hasWf && options.length >= 2
}

/**
 * 若该环节尚未选工作流则弹出 ask。
 * @param projectTabId 项目 id
 * @param stage 环节
 * @param resumeTrigger 续跑触发点
 */
export function ensureDramaStageGenChoiceOrPrompt(
  projectTabId: string,
  stage: DramaGenStage,
  resumeTrigger: DramaAutoPipelineTrigger,
): boolean {
  if (isDramaStageGenChoiceDone(projectTabId, stage)) return false
  promptDramaStageGenChoice(projectTabId, stage, resumeTrigger)
  return true
}

/**
 * 由流水线触发点推断当前应先选的环节并弹出 ask。
 * @param projectTabId 项目 id
 * @param resumeTrigger 触发点
 */
export function ensureDramaStageGenChoiceForTrigger(
  projectTabId: string,
  resumeTrigger: DramaAutoPipelineTrigger,
): boolean {
  const state = loadDramaProductionState(projectTabId)
  let stage = dramaTriggerToGenStage(resumeTrigger)
  if (resumeTrigger === 'characters_written' && state?.characters.some((c) => c.designImageSrc?.trim())) {
    stage = 'character_concept'
  }
  return ensureDramaStageGenChoiceOrPrompt(projectTabId, stage, resumeTrigger)
}

/** 读取待处理的环节 ask（供 UI 解析 stage） */
export function peekPendingDramaStageGenAsk(projectTabId: string): DramaGenStage | null {
  return pendingByProject.get(projectTabId)?.stage ?? null
}
