import type { DramaProductionPhase } from './types'
import { DRAMA_PHASE_ORDER } from './dramaPhases'

/**
 * @param phase 制片阶段
 */
function phaseRank(phase: DramaProductionPhase): number {
  const i = DRAMA_PHASE_ORDER.indexOf(phase)
  return i < 0 ? 0 : i
}

/**
 * 当前阶段是否已达到指定阶段。
 * @param phase 当前阶段
 * @param min 目标阶段
 */
export function isDramaPhaseAtLeast(phase: DramaProductionPhase, min: DramaProductionPhase): boolean {
  return phaseRank(phase) >= phaseRank(min)
}
