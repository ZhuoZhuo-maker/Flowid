import type { NodeRunStatus } from '../types'

/**
 * 画布 ↔ 全屏助手侧栏「当前任务」最小桥：由 StudioApp 注册 provider / 导航。
 */

export type AgentCanvasTaskItem = {
  nodeId: string
  /** 与 Studio 节点 data.kind 或 type 对齐，用于侧栏图标 */
  kind: string
  title: string
  runStatus?: NodeRunStatus
  runProgress?: { percent: number; label: string }
  /** 用于稳定排序：先 y 后 x */
  sortY: number
  sortX: number
}

let tasksProvider: (() => AgentCanvasTaskItem[]) | null = null
let navigateToNode: ((nodeId: string) => void) | null = null

export function registerAgentCanvasTasksProvider(fn: (() => AgentCanvasTaskItem[]) | null): void {
  tasksProvider = fn
}

export function registerAgentNavigateToNode(fn: ((nodeId: string) => void) | null): void {
  navigateToNode = fn
}

export function getAgentCanvasTasks(): AgentCanvasTaskItem[] {
  if (!tasksProvider) return []
  try {
    return tasksProvider()
  } catch {
    return []
  }
}

export function navigateAgentCanvasToNode(nodeId: string): void {
  navigateToNode?.(nodeId)
}
