/**
 * 示例积分规则（可整体替换为服务端计价 / 会员表）。
 * 当前：识别「N张」场景图，每张 10 积分，最低 10 积分。
 */

export type PointsEstimate = {
  sceneCount: number
  pointsPerScene: number
  points: number
  explanation: string
}

const DEFAULT_PER = 10

export function estimateSceneBatchFromText(text: string): PointsEstimate {
  const trimmed = text.trim()
  const m = trimmed.match(/(\d+)\s*张/)
  const sceneCount = m ? Math.min(9999, Math.max(1, parseInt(m[1], 10))) : 1
  const points = Math.max(DEFAULT_PER, sceneCount * DEFAULT_PER)
  return {
    sceneCount,
    pointsPerScene: DEFAULT_PER,
    points,
    explanation: `按示例规则：${sceneCount} 张场景图 × ${DEFAULT_PER} 积分/张 = ${points} 积分`,
  }
}
