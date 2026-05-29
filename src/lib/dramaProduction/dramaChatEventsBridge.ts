import type { DramaAgentPersonaId } from './dramaAgentPersonas'

/** 聊天区系统事件（Agent 邀请加入等） */
export type DramaChatHandoverEvent = {
  id: string
  type: 'handover'
  from: DramaAgentPersonaId
  to: DramaAgentPersonaId
  ts: number
}

const eventsByProject = new Map<string, DramaChatHandoverEvent[]>()
const listeners = new Set<() => void>()

/**
 * 记录 Agent 邀请加入群聊
 */
export function pushDramaHandover(
  projectTabId: string,
  from: DramaAgentPersonaId,
  to: DramaAgentPersonaId,
): void {
  if (!projectTabId) return
  const list = eventsByProject.get(projectTabId) ?? []
  list.push({ id: `${Date.now()}-${list.length}`, type: 'handover', from, to, ts: Date.now() })
  eventsByProject.set(projectTabId, list)
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

/** 读取项目全部聊天事件 */
export function getDramaChatEvents(projectTabId: string): DramaChatHandoverEvent[] {
  if (!projectTabId) return []
  return [...(eventsByProject.get(projectTabId) ?? [])]
}

/** 订阅事件变化 */
export function subscribeDramaChatEvents(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
