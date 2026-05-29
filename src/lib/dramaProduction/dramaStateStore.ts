import {
  createInitialDramaProductionState,
  type DramaProductionState,
} from './types'
import { notifyDramaStateChanged } from './dramaWorkspaceBridge'
import { resolveActiveExpertForState } from './dramaOrchestrator'
import { DRAMA_AGENT_PERSONAS } from './dramaAgentPersonas'

const STORAGE_PREFIX = 'flowid.drama.state.v1.'

/**
 * @param projectTabId 项目标签 id
 */
export function loadDramaProductionState(projectTabId: string): DramaProductionState | null {
  if (!projectTabId) return null
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectTabId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DramaProductionState
    if (parsed?.version !== 1 || parsed.toolId !== 'short-drama') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * @param projectTabId 项目标签 id
 * @param state 制片状态
 */
export function saveDramaProductionState(projectTabId: string, state: DramaProductionState): void {
  if (!projectTabId) return
  try {
    localStorage.setItem(
      STORAGE_PREFIX + projectTabId,
      JSON.stringify({ ...state, updatedAtMs: Date.now() }),
    )
  } catch {
    /* ignore */
  }
}

/**
 * 初始化或读取短剧制片状态。
 * @param projectTabId 项目标签 id
 */
export function ensureDramaProductionState(projectTabId: string): DramaProductionState {
  const existing = loadDramaProductionState(projectTabId)
  if (existing) return existing
  const init = createInitialDramaProductionState()
  saveDramaProductionState(projectTabId, init)
  return init
}

/**
 * 合并更新制片状态。
 */
export function patchDramaProductionState(
  projectTabId: string,
  patch: Partial<DramaProductionState>,
): DramaProductionState {
  const base = ensureDramaProductionState(projectTabId)
  const next = { ...base, ...patch, updatedAtMs: Date.now() }
  saveDramaProductionState(projectTabId, next)
  notifyDramaStateChanged()
  return next
}

/**
 * 生成供 LLM 阅读的制片状态摘要。
 */
export function summarizeDramaStateForLlm(state: DramaProductionState): string {
  const expertId = resolveActiveExpertForState(state)
  const expertName = DRAMA_AGENT_PERSONAS[expertId].name
  const lines: string[] = [
    `当前活跃专家：${expertName}（${expertId}）`,
    `当前阶段：${state.phase}`,
    `制作参数：概念=${state.spec.concept || '（未填）'}；平台=${state.spec.targetPlatform || '（未填）'}；风格=${state.spec.visualStyle || '（未填）'}；画幅=${state.spec.aspect}；镜头数=${state.spec.shotCount}`,
    `剧本字数：${state.scriptBody.length}`,
    `角色数：${state.characters.length}；场景数：${state.locations.length}；分镜数：${state.shots.length}`,
  ]
  if (state.review) {
    lines.push(`合规：${state.review.passed ? '通过' : '待改'} — ${state.review.compliance.slice(0, 120)}`)
  }
  return lines.join('\n')
}
