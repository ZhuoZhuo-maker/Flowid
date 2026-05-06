/**
 * 全屏助手侧栏「当前项目」：由 StudioApp 注册，仅列出画布上已打开的项目标签。
 */

export type AgentProjectContextItem = {
  id: string
  /** 主文案（工程名或文件名） */
  label: string
  /** 副文案：路径说明或来源文件 */
  description?: string
  /** 当前激活的画布标签 */
  isActive?: boolean
}

let provider: (() => AgentProjectContextItem[]) | null = null

export function registerAgentProjectContextProvider(fn: (() => AgentProjectContextItem[]) | null): void {
  provider = fn
}

export function getAgentProjectContextItems(): AgentProjectContextItem[] {
  if (!provider) return []
  try {
    return provider()
  } catch {
    return []
  }
}
