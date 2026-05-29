import type { DramaAgentPersonaId } from './dramaAgentPersonas'
import { buildDramaExpertSystemPrompt } from './dramaExpertPrompts'
import { resolveActiveExpertForState } from './dramaOrchestrator'
import { summarizeDramaStateForLlm } from './dramaStateStore'
import type { DramaProductionState } from './types'

/**
 * 构建短剧制片 Agent 系统提示词（按当前活跃专家注入专属 prompt）。
 * @param state 制片状态
 * @param canvasBrief 画布节点摘要
 * @param expertOverride 强制指定专家（可选）
 */
export function buildDramaPmSystemPrompt(
  state: DramaProductionState,
  canvasBrief: string,
  expertOverride?: DramaAgentPersonaId,
): string {
  const expertId = expertOverride ?? resolveActiveExpertForState(state)
  return buildDramaExpertSystemPrompt(expertId, state, canvasBrief)
}

/** @deprecated 仅供兼容引用；请使用 buildDramaPmSystemPrompt */
export function summarizeDramaState(state: DramaProductionState): string {
  return summarizeDramaStateForLlm(state)
}
