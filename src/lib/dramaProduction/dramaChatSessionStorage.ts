import type { StoredAiMessage } from '../aiSessionsStorage'

const SESSION_LINK_PREFIX = 'flowid.drama.chatSession.v1.'

/**
 * 是否已有用户主动输入的题材（排除 ask_user 选项）。
 * @param messages 会话消息
 */
export function dramaHasUserTheme(messages: StoredAiMessage[]): boolean {
  return messages.some((m) => m.role === 'user' && !/【用户选择】/.test(m.content))
}

/**
 * 短剧项目绑定的聊天会话 id。
 * @param projectTabId 项目标签 id
 */
export function loadDramaProjectSessionId(projectTabId: string): string | null {
  if (!projectTabId) return null
  try {
    return localStorage.getItem(SESSION_LINK_PREFIX + projectTabId)
  } catch {
    return null
  }
}

/**
 * 绑定短剧项目与聊天会话。
 * @param projectTabId 项目标签 id
 * @param sessionId 会话 id
 */
export function saveDramaProjectSessionId(projectTabId: string, sessionId: string): void {
  if (!projectTabId || !sessionId) return
  try {
    localStorage.setItem(SESSION_LINK_PREFIX + projectTabId, sessionId)
  } catch {
    /* ignore */
  }
}

/**
 * 用户尚未输入题材时，清除误写入的助手消息（避免首屏堆叠重复气泡）。
 * @param messages 原始消息
 */
export function sanitizeDramaSessionMessages(messages: StoredAiMessage[]): StoredAiMessage[] {
  if (dramaHasUserTheme(messages)) return messages
  return []
}
