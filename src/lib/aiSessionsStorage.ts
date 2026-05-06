/**
 * 全屏 AI 助手：多会话持久化（localStorage）
 */

export const AI_SESSIONS_STORAGE_KEY = 'flowid_ai_sessions'
export const AI_CURRENT_SESSION_STORAGE_KEY = 'flowid_current_session'

export type StoredAiMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export type AiSession = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: StoredAiMessage[]
}

export function createEmptySession(now = Date.now()): AiSession {
  const id = crypto.randomUUID()
  const timeLabel = new Date(now).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return {
    id,
    title: `新对话 ${timeLabel}`,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

/**
 * 从首条用户消息推导会话标题：使用**整段首行**（到换行为止），与聊天里看到的第一句一致，不做「摘要截断」。
 * 仅对极端超长单行做硬上限，避免误粘贴巨型文本撑爆 localStorage。
 */
const SESSION_TITLE_FIRST_LINE_MAX = 20000

export function titleFromFirstUserMessage(messages: StoredAiMessage[]): string {
  const u = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!u) return ''
  const firstLine = (u.content.trim().split(/\r?\n/)[0] ?? '').trim()
  if (firstLine.length <= SESSION_TITLE_FIRST_LINE_MAX) return firstLine
  return firstLine.slice(0, SESSION_TITLE_FIRST_LINE_MAX)
}

export function loadSessions(): AiSession[] {
  try {
    const raw = localStorage.getItem(AI_SESSIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidSession)
  } catch {
    return []
  }
}

export function saveSessions(sessions: AiSession[]): void {
  try {
    localStorage.setItem(AI_SESSIONS_STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // 配额满等：静默失败，避免打断聊天
  }
}

export function loadCurrentSessionId(): string | null {
  try {
    return localStorage.getItem(AI_CURRENT_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveCurrentSessionId(id: string): void {
  try {
    localStorage.setItem(AI_CURRENT_SESSION_STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}

function isValidSession(x: unknown): x is AiSession {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.updatedAt === 'number' &&
    Array.isArray(o.messages)
  )
}
