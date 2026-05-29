/** 自动制片流水线触发点 */
export type DramaAutoPipelineTrigger =
  | 'characters_written'
  | 'locations_written'
  | 'shots_written'
  | 'character_images_done'
  | 'scene_main_done'
  | 'scene_multiview_done'
  | 'storyboard_images_done'

type PipelineHook = (tabId: string, trigger: DramaAutoPipelineTrigger) => void

let pipelineHook: PipelineHook | null = null
let pipelineScheduler: PipelineHook | null = null

/**
 * 注册流水线 hook（由 dramaAutoPipeline 在启动时注入）。
 * @param hook 回调
 */
export function setDramaAutoPipelineHook(hook: PipelineHook | null): void {
  pipelineHook = hook
}

/**
 * 注册流水线调度（续跑出图方式选择之后）。
 * @param fn 调度函数
 */
export function setDramaAutoPipelineScheduler(fn: PipelineHook | null): void {
  pipelineScheduler = fn
}

/**
 * 通知流水线进入下一步（出图/写入数据完成后调用）。
 * @param tabId 项目 id
 * @param trigger 触发点
 */
export function notifyDramaAutoPipelineStep(tabId: string, trigger: DramaAutoPipelineTrigger): void {
  if (!tabId || !pipelineHook) return
  pipelineHook(tabId, trigger)
}

/**
 * 用户选择出图方式后续跑流水线。
 * @param tabId 项目 id
 * @param trigger 触发点
 */
export function resumeDramaAutoPipeline(tabId: string, trigger: DramaAutoPipelineTrigger): void {
  if (!tabId || !pipelineScheduler) return
  pipelineScheduler(tabId, trigger)
}
