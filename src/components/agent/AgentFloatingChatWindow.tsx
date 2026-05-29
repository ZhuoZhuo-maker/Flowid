import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { motion } from 'motion/react'
import {
  createEmptySession,
  loadCurrentSessionId,
  loadSessions,
  saveCurrentSessionId,
  saveSessions,
  titleFromFirstUserMessage,
  type AiSession,
  type StoredAiMessage,
} from '../../lib/aiSessionsStorage'
import {
  AGENT_PARSE_MODE_OPTIONS,
  loadStoredAgentParseMode,
  saveStoredAgentParseMode,
  type AgentParseMode,
} from '../../lib/agentParseMode'
import {
  getAgentCanvasTasks,
  navigateAgentCanvasToNode,
  type AgentCanvasTaskItem,
} from '../../lib/agentCanvasBridge'
import { filesToInputSnippetsConcat } from '../../lib/agentDroppedFileSnippets'
import { getAgentProjectContextItems, type AgentProjectContextItem } from '../../lib/agentProjectContextBridge'
import {
  awaitSensitiveLexiconSettled,
  canSend as sensitiveCanSend,
  replaceSensitiveWords,
} from '../../lib/sensitiveWords'
import { alertSensitiveWordBlocked } from '../../lib/sensitiveWordUi'
import { invokeStudioAgentChat, type StudioAgentChatTurn } from '../../lib/studioAgentBridge'
import { setDramaWorkspaceTab } from '../../lib/dramaProduction/dramaWorkspaceBridge'
import {
  getDramaAskUserPending,
  setDramaAskUserPending,
  subscribeDramaAskUser,
  type DramaAskUserPayload,
} from '../../lib/dramaProduction/dramaAskUserBridge'
import {
  confirmDramaStageGenChoice,
  isDramaStageGenChoiceAsk,
  parseDramaStageGenChoiceFromText,
  peekPendingDramaStageGenAsk,
  resumeDramaPipelineAfterStageGenChoice,
} from '../../lib/dramaProduction/dramaStageGenChoice'
import type { DramaGenStage } from '../../lib/dramaProduction/dramaGenStages'
import '../../lib/dramaProduction/dramaAutoPipeline'
import { AgentWorkspaceChatArea } from './workspace/AgentWorkspaceChatArea'
import { AgentWorkspaceInputArea } from './workspace/AgentWorkspaceInputArea'
import { AgentWorkspaceSidebar } from './workspace/AgentWorkspaceSidebar'
import { AgentWorkspaceTopBar } from './workspace/AgentWorkspaceTopBar'
import {
  DramaAgentSideRail,
  dramaRailTabNodeKeyword,
  type DramaRailTab,
} from './DramaAgentSideRail'
import { DramaAgentChatHeader } from './drama/DramaAgentChatHeader'
import { DramaAgentChatFeed } from './drama/DramaAgentChatFeed'
import { DramaAgentInputArea } from './drama/DramaAgentInputArea'
import {
  getDramaChatSteps,
  subscribeDramaChatSteps,
} from '../../lib/dramaProduction/dramaChatStepsBridge'
import {
  getDramaChatEvents,
  subscribeDramaChatEvents,
} from '../../lib/dramaProduction/dramaChatEventsBridge'
import { getDramaUiState, subscribeDramaUiState } from '../../lib/dramaProduction/dramaUiBridge'
import { loadDramaProductionState, ensureDramaProductionState } from '../../lib/dramaProduction/dramaStateStore'
import { subscribeDramaStateChanged } from '../../lib/dramaProduction/dramaWorkspaceBridge'
import { formatDramaExpertReply } from '../../lib/dramaProduction/dramaExpertPrompts'
import { resolveActiveExpertForState } from '../../lib/dramaProduction/dramaOrchestrator'
import {
  dramaHasUserTheme,
  loadDramaProjectSessionId,
  sanitizeDramaSessionMessages,
  saveDramaProjectSessionId,
} from '../../lib/dramaProduction/dramaChatSessionStorage'

type ChatMsg = { id: string; role: 'user' | 'assistant'; text: string; ts: number }

export type AgentWorkspaceLayout = 'fullscreen' | 'split'

type Props = {
  open: boolean
  busy: boolean
  ttsEnabled?: boolean
  onSpeak?: (text: string) => Promise<void>
  /** 返回画布 / 关闭整页 Agent 视图 */
  onClose: () => void
  /**
   * 分栏模式下顶栏「返回画布」：默认不切全屏关闭，而是切到右侧节点画布。
   * 未传入时 split 布局仍走 onClose。
   */
  onBackToCanvas?: () => void
  /** 分栏模式：收起左侧 Agent，恢复全宽画布 */
  onDismissSplit?: () => void
  /** 同步「正在请求模型」状态，供画布右下角虚拟人与思考动画一致 */
  onWorkspaceSendingChange?: (sending: boolean) => void
  /** 与设置面板「AI 虚拟助手」中的模型名一致，用于输入条模式按钮展示 */
  assistantModelName?: string
  /** 从首页 Agent 工具启动时注入的首条引导（仅展示一次） */
  initialWelcomeMessage?: string | null
  onInitialWelcomeConsumed?: () => void
  /** fullscreen = 全屏工作台；split = 左侧嵌入（智剧通式，右侧为画布） */
  layout?: AgentWorkspaceLayout
  /** drama = 短剧制片深色分栏；default = 原有助手样式 */
  uiVariant?: 'default' | 'drama'
  /** 短剧制片：显示左侧 剧本/角色/分镜/视频 图标栏 */
  dramaProductionMode?: boolean
  /** 短剧项目标签 id，用于侧栏显示当前阶段 */
  dramaProjectTabId?: string | null
  /** 短剧 Agent 顶栏：当前项目名称 */
  dramaProjectTitle?: string
  /** 短剧 Agent 顶栏：双击重命名项目 */
  onRenameDramaProjectTitle?: (name: string) => void
  /** 用户首条题材输入后自动重命名项目（仅一次） */
  onDramaAutoRenameFromTheme?: (themeText: string) => void
  /** 点击侧栏 Tab 时在右侧画布定位节点 */
  onFocusCanvasKeyword?: (keyword: string) => void
}

function bootSessions(): { sessions: AiSession[]; currentId: string } {
  let list = loadSessions()
  if (!list.length) {
    const s = createEmptySession()
    list = [s]
    saveSessions(list)
  }
  let cid = loadCurrentSessionId()
  if (!cid || !list.some((x) => x.id === cid)) {
    const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
    cid = sorted[0]!.id
  }
  saveCurrentSessionId(cid)
  return { sessions: list, currentId: cid }
}

/** 上一条用户内容是否以 @提及 结尾（可选 `(uuid)`） */
function endsWithAgentMentionToken(text: string): boolean {
  return /@\[[^\]]+\](?:\([0-9a-fA-F-]{36}\))?\s*$/u.test(text.trimEnd())
}

/** 本条是否像「新的 @提及」开头（避免把两次独立 @ 拖入合并成一条） */
function startsWithNewAgentMention(text: string): boolean {
  return /^\s*@\[[^\]]+\]\(/u.test(text)
}

/**
 * 上一条以 @提及 结尾、本条在短时间窗内且不是新的 @ 行时，视为同一次输入的补充（修复连发/误触导致「@ 一条、正文一条」）。
 */
function shouldMergeUserFollowup(prevContent: string, nextRaw: string, ageMs: number): boolean {
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 12000) return false
  if (!endsWithAgentMentionToken(prevContent)) return false
  if (startsWithNewAgentMention(nextRaw)) return false
  return true
}

function coalesceAdjacentUserFollowups(messages: StoredAiMessage[]): StoredAiMessage[] {
  const out: StoredAiMessage[] = []
  for (const m of messages) {
    if (m.role !== 'user') {
      out.push(m)
      continue
    }
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.role === 'user' &&
      shouldMergeUserFollowup(prev.content, m.content, m.timestamp - prev.timestamp)
    ) {
      out[out.length - 1] = {
        ...prev,
        content: `${prev.content.trimEnd()} ${m.content.trim()}`.trim(),
        timestamp: m.timestamp,
      }
      continue
    }
    out.push({ ...m })
  }
  return out
}

function storedToUi(messages: StoredAiMessage[]): ChatMsg[] {
  const coalesced = coalesceAdjacentUserFollowups(messages)
  return coalesced.map((m, i) => ({
    id: `${m.timestamp}-${i}-${m.role}`,
    role: m.role,
    text: m.content,
    ts: m.timestamp,
  }))
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function sessionTimeBucket(updatedAt: number, now = Date.now()): 'today' | 'yesterday' | 'older' {
  const t0 = startOfLocalDay(now)
  const t1 = t0 - 86400000
  const u = startOfLocalDay(updatedAt)
  if (u >= t0) return 'today'
  if (u >= t1) return 'yesterday'
  return 'older'
}

function sortTasks(a: AgentCanvasTaskItem, b: AgentCanvasTaskItem): number {
  if (a.sortY !== b.sortY) return a.sortY - b.sortY
  return a.sortX - b.sortX
}

/**
 * 全屏 Agent 工作台：UI 自 `flowid-ai-assistant.zip` 迁入（Tailwind），逻辑仍接 FlowID 会话存储与画布桥。
 */
export function AgentFloatingChatWindow({
  open,
  busy: canvasBusy,
  ttsEnabled,
  onSpeak,
  onClose,
  onBackToCanvas,
  onDismissSplit,
  onWorkspaceSendingChange,
  assistantModelName,
  initialWelcomeMessage,
  onInitialWelcomeConsumed,
  layout = 'fullscreen',
  uiVariant = 'default',
  dramaProductionMode = false,
  dramaProjectTabId = null,
  dramaProjectTitle,
  onRenameDramaProjectTitle,
  onDramaAutoRenameFromTheme,
  onFocusCanvasKeyword,
}: Props) {
  const isSplit = layout === 'split'
  const isDrama = uiVariant === 'drama' && isSplit
  const boot = useMemo(() => bootSessions(), [])
  const [sessions, setSessions] = useState<AiSession[]>(() => boot.sessions)
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => boot.currentId)
  const [parseMode, setParseMode] = useState<AgentParseMode>(() => loadStoredAgentParseMode())
  const [dramaRailTab, setDramaRailTab] = useState<DramaRailTab>('script')
  const [modeSwitchHint, setModeSwitchHint] = useState<string | null>(null)
  const modeHintTimerRef = useRef<number | null>(null)
  const [tasks, setTasks] = useState<AgentCanvasTaskItem[]>([])
  const [projectItems, setProjectItems] = useState<AgentProjectContextItem[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [dramaAskUser, setDramaAskUser] = useState<DramaAskUserPayload | null>(() =>
    getDramaAskUserPending(),
  )
  const [dramaSteps, setDramaSteps] = useState(() =>
    dramaProjectTabId ? getDramaChatSteps(dramaProjectTabId) : [],
  )
  const [dramaEvents, setDramaEvents] = useState(() =>
    dramaProjectTabId ? getDramaChatEvents(dramaProjectTabId) : [],
  )
  const [dramaState, setDramaState] = useState(() =>
    dramaProjectTabId ? loadDramaProductionState(dramaProjectTabId) : null,
  )
  const [dramaUi, setDramaUi] = useState(() =>
    dramaProjectTabId ? getDramaUiState(dramaProjectTabId) : getDramaUiState(''),
  )
  const dramaAutoSendRef = useRef<string | null>(null)
  useEffect(() => subscribeDramaAskUser(() => setDramaAskUser(getDramaAskUserPending())), [])
  useEffect(() => {
    if (!isDrama || !dramaProjectTabId) return
    const refresh = () => {
      setDramaSteps(getDramaChatSteps(dramaProjectTabId))
      setDramaEvents(getDramaChatEvents(dramaProjectTabId))
      setDramaState(loadDramaProductionState(dramaProjectTabId))
      setDramaUi(getDramaUiState(dramaProjectTabId))
    }
    refresh()
    const unsubSteps = subscribeDramaChatSteps(refresh)
    const unsubEvents = subscribeDramaChatEvents(refresh)
    const unsubState = subscribeDramaStateChanged(refresh)
    const unsubUi = subscribeDramaUiState(refresh)
    return () => {
      unsubSteps()
      unsubEvents()
      unsubState()
      unsubUi()
    }
  }, [isDrama, dramaProjectTabId])

  useEffect(() => {
    onWorkspaceSendingChange?.(sending)
    return () => {
      onWorkspaceSendingChange?.(false)
    }
  }, [sending, onWorkspaceSendingChange])

  /** 全屏模式才锁底层页面滚动；分栏模式右侧画布需可交互 */
  useEffect(() => {
    if (!open || isSplit) return
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevBodyPadRight = body.style.paddingRight
    const gutter = Math.max(0, window.innerWidth - html.clientWidth)
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    if (gutter > 0) body.style.paddingRight = `${gutter}px`
    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      body.style.paddingRight = prevBodyPadRight
    }
  }, [open, isSplit])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(isSplit)

  const [profilePanelOpen, setProfilePanelOpen] = useState(false)
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false)
  const [sessionSearchQuery, setSessionSearchQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const lastSpokenKeyRef = useRef<string | null>(null)
  /** 防止连点发送或 Enter 重复触发在同一帧内跑两次 handleSend */
  const sendInFlightRef = useRef(false)
  const welcomeInjectedRef = useRef<string | null>(null)

  /** 从首页 Agent 工具进入时同步解析模式，并注入引导消息 */
  useEffect(() => {
    if (!open) return
    setParseMode(loadStoredAgentParseMode())
    if (uiVariant === 'drama' && layout === 'split') {
      onInitialWelcomeConsumed?.()
      return
    }
    const welcome = String(initialWelcomeMessage || '').trim()
    if (!welcome || welcomeInjectedRef.current === welcome) return
    welcomeInjectedRef.current = welcome
    const storedMsg: StoredAiMessage = {
      role: 'assistant',
      content: welcome.replace(/\*\*(.+?)\*\*/g, '$1'),
      timestamp: Date.now(),
    }
    setSessions((prev) => {
      const cid = currentSessionId
      const next = prev.map((s) =>
        s.id === cid
          ? { ...s, messages: [...s.messages, storedMsg], updatedAt: Date.now() }
          : s,
      )
      saveSessions(next)
      return next
    })
    onInitialWelcomeConsumed?.()
  }, [open, initialWelcomeMessage, currentSessionId, onInitialWelcomeConsumed, uiVariant, layout])

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) ?? sessions[0]!,
    [sessions, currentSessionId],
  )

  const onPickDramaRailTab = useCallback(
    (tab: DramaRailTab) => {
      setDramaRailTab(tab)
      setDramaWorkspaceTab(tab)
      const kw = dramaRailTabNodeKeyword(tab)
      if (kw) onFocusCanvasKeyword?.(kw)
    },
    [onFocusCanvasKeyword],
  )

  const messages = useMemo(() => storedToUi(currentSession.messages), [currentSession.messages])

  /** 短剧：按项目绑定独立会话；未发题材前清空误存的助手消息 */
  useEffect(() => {
    if (!isDrama || !dramaProjectTabId) return
    let list = loadSessions()
    if (!list.length) {
      const s = createEmptySession()
      list = [s]
      saveSessions(list)
    }

    let sid = loadDramaProjectSessionId(dramaProjectTabId)
    if (!sid || !list.some((s) => s.id === sid)) {
      const fresh = createEmptySession()
      list = [fresh, ...list]
      sid = fresh.id
      saveDramaProjectSessionId(dramaProjectTabId, sid)
    }

    const linked = list.find((s) => s.id === sid)
    if (linked) {
      const cleaned = sanitizeDramaSessionMessages(linked.messages)
      if (cleaned.length !== linked.messages.length) {
        list = list.map((s) =>
          s.id === sid ? { ...s, messages: cleaned, updatedAt: Date.now() } : s,
        )
        saveSessions(list)
      }
    }

    setSessions(list)
    setCurrentSessionId(sid)
    saveCurrentSessionId(sid)
  }, [isDrama, dramaProjectTabId])

  const chatAreaMessages = useMemo(
    () => messages.map((m) => ({ id: m.id, role: m.role, content: m.text, ts: m.ts })),
    [messages],
  )

  /** 尚无消息：首屏输入居中；短剧模式以「是否已发题材」为准 */
  const isHome = isDrama
    ? !dramaHasUserTheme(currentSession.messages)
    : messages.length === 0

  /** 有任意消息后：可滚动消息列表 + 底部悬浮输入 */
  const composerDocked = !isHome

  const filteredSessionsForSearch = useMemo(() => {
    const q = sessionSearchQuery.trim().toLowerCase()
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted
    return sorted.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, sessionSearchQuery])

  const renameSession = useCallback((id: string, nextTitle: string) => {
    const t = nextTitle.trim() || '未命名对话'
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: t, updatedAt: Date.now() } : s)),
    )
  }, [])

  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])

  useEffect(() => {
    saveCurrentSessionId(currentSessionId)
  }, [currentSessionId])

  useEffect(() => {
    if (sessions.some((s) => s.id === currentSessionId)) return
    const pick = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (pick) setCurrentSessionId(pick.id)
  }, [sessions, currentSessionId])

  const groupedSessions = useMemo(() => {
    const now = Date.now()
    const buckets: { key: 'today' | 'yesterday' | 'older'; title: string; items: AiSession[] }[] = [
      { key: 'today', title: '今天', items: [] },
      { key: 'yesterday', title: '昨天', items: [] },
      { key: 'older', title: '更早', items: [] },
    ]
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
    for (const s of sorted) {
      const b = sessionTimeBucket(s.updatedAt, now)
      buckets.find((x) => x.key === b)?.items.push(s)
    }
    return buckets.filter((g) => g.items.length > 0)
  }, [sessions])

  const sessionSections = useMemo(
    () => groupedSessions.map((g) => ({ title: g.title, items: g.items })),
    [groupedSessions],
  )

  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (!el) return
    // 仅欢迎语首屏：外层是纵向居中可滚动区，滚到 scrollHeight 会把顶部的欢迎气泡滚出视口（用户误以为「新建没有这句」）
    if (isHome) {
      el.scrollTop = 0
      return
    }
    el.scrollTop = el.scrollHeight
  }, [messages, open, isHome])

  useEffect(() => {
    if (!open || !ttsEnabled || !onSpeak) return
    const last = messages.filter((m) => m.role === 'assistant').pop()
    if (!last) return
    const key = `${last.ts}-${last.text.slice(0, 40)}`
    if (lastSpokenKeyRef.current === key) return
    lastSpokenKeyRef.current = key
    void onSpeak(last.text).catch(() => {})
  }, [messages, onSpeak, open, ttsEnabled])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (sessionSearchOpen) {
        e.preventDefault()
        setSessionSearchOpen(false)
        setSessionSearchQuery('')
        return
      }
      if (isSplit && onBackToCanvas) {
        e.preventDefault()
        onBackToCanvas()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose, onBackToCanvas, isSplit, sessionSearchOpen])

  useEffect(() => {
    if (!open) return
    const tick = () => setTasks(getAgentCanvasTasks().slice().sort(sortTasks))
    tick()
    const id = window.setInterval(tick, 400)
    return () => window.clearInterval(id)
  }, [open])

  /** 工程名 / 路径会随标签切换、设置变更而变，轮询刷新侧栏「当前项目」 */
  useEffect(() => {
    if (!open) return
    const tick = () => {
      let items = getAgentProjectContextItems()
      if (!items.length && getAgentCanvasTasks().length > 0) {
        items = [
          {
            id: 'canvas-fallback',
            label: '当前画布',
            description: '已与画布节点同步；若项目名称未显示，可关闭助手再开或刷新页面。',
            isActive: true,
          },
        ]
      }
      setProjectItems(items)
    }
    tick()
    const id = window.setInterval(tick, 900)
    return () => window.clearInterval(id)
  }, [open])

  const upsertSession = useCallback((sessionId: string, updater: (s: AiSession) => AiSession) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? updater(s) : s)))
  }, [])

  const canvasProjectTitle = useMemo(() => {
    const active = projectItems.find((i) => i.isActive)
    const label = (active?.label ?? projectItems[0]?.label ?? '').trim()
    return label || '未命名项目'
  }, [projectItems])

  /** 侧栏「清空」：移除全部会话记录，并新建一条空白会话 */
  const clearAllSessions = useCallback(() => {
    if (
      !window.confirm(
        '确定清空全部会话记录？侧栏中所有会话、标题与消息将一并移除，并自动新建一条空白会话。此操作不可恢复。',
      )
    )
      return
    lastSpokenKeyRef.current = null
    const fresh = createEmptySession()
    setSessions([fresh])
    setCurrentSessionId(fresh.id)
  }, [])

  const onNewChat = useCallback(() => {
    const s = createEmptySession()
    setSessions((prev) => [s, ...prev])
    setCurrentSessionId(s.id)
  }, [])

  /** Ctrl+N / Cmd+N：新建助手会话（与侧栏「新建助手」一致） */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.key.toLowerCase() !== 'n') return
      e.preventDefault()
      onNewChat()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onNewChat])

  const onPickSession = useCallback((id: string) => {
    setCurrentSessionId(id)
  }, [])

  const onDeleteSession = useCallback((e: MouseEvent, id: string) => {
    e.stopPropagation()
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      return next.length ? next : [createEmptySession()]
    })
  }, [])

  const onPickParseMode = useCallback((m: AgentParseMode) => {
    setParseMode(m)
    saveStoredAgentParseMode(m)
    const opt = AGENT_PARSE_MODE_OPTIONS.find((o) => o.value === m)
    const label = opt?.hint ?? m
    setModeSwitchHint(`已切换到 ${label} 模式`)
    if (modeHintTimerRef.current) window.clearTimeout(modeHintTimerRef.current)
    modeHintTimerRef.current = window.setTimeout(() => setModeSwitchHint(null), 3200)
  }, [])

  const blocked = canvasBusy || sending

  /** 拖到对话列表区域时，把文件内容并入底部输入框（与输入框内拖入行为一致） */
  const handleMainFileDragOver = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (blocked) return
      if (!Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [blocked],
  )

  const handleMainFileDrop = useCallback(
    async (e: DragEvent<HTMLElement>) => {
      if (blocked) return
      const fl = e.dataTransfer.files
      if (!fl?.length) return
      e.preventDefault()
      e.stopPropagation()
      const sn = await filesToInputSnippetsConcat(fl)
      if (!sn.trim()) return
      setInput((prev) => {
        const t = prev.replace(/\s+$/, '')
        return t ? `${t}\n${sn.trimStart()}` : sn.trimStart()
      })
    },
    [blocked],
  )
  const canSend = useMemo(() => input.trim().length > 0 && !blocked, [input, blocked])

  const handleSend = useCallback(async () => {
    if (!canSend || sendInFlightRef.current) return
    await awaitSensitiveLexiconSettled()
    const raw = input.trim()
    const now = Date.now()
    const sid = currentSessionId
    const prevMsgs = currentSession.messages
    const last = prevMsgs[prevMsgs.length - 1]

    let textForModel = raw
    if (last?.role === 'user' && shouldMergeUserFollowup(last.content, raw, now - last.timestamp)) {
      textForModel = `${last.content.trimEnd()} ${raw.trim()}`.trim()
    }

    const gate = sensitiveCanSend(textForModel)
    if (!gate.allowed) {
      alertSensitiveWordBlocked(gate.reason ?? '消息包含敏感内容，无法发送')
      return
    }

    const safeOutgoing = replaceSensitiveWords(textForModel)
    sendInFlightRef.current = true
    setInput('')

    const userMsg: StoredAiMessage = { role: 'user', content: safeOutgoing, timestamp: now }
    let messagesNext: StoredAiMessage[]
    if (last?.role === 'user' && shouldMergeUserFollowup(last.content, raw, now - last.timestamp)) {
      messagesNext = [...prevMsgs.slice(0, -1), { ...last, content: safeOutgoing, timestamp: now }]
    } else {
      messagesNext = [...prevMsgs, userMsg]
    }

    const historyTurns: StudioAgentChatTurn[] = (last?.role === 'user' && textForModel !== raw
      ? prevMsgs.slice(0, -1)
      : prevMsgs
    )
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))

    upsertSession(sid, (s) => {
      const derived = titleFromFirstUserMessage(messagesNext)
      const titleNext = derived || s.title
      return {
        ...s,
        title: titleNext,
        messages: messagesNext,
        updatedAt: now,
      }
    })

    const isUserThemeInput = !/【用户选择】/.test(safeOutgoing)
    const isFirstTheme =
      isUserThemeInput && !dramaHasUserTheme(prevMsgs)
    if (isDrama && dramaProjectTabId && isFirstTheme) {
      onDramaAutoRenameFromTheme?.(safeOutgoing)
    }

    setSending(true)
    const chatMode: AgentParseMode = isDrama ? 'llm' : parseMode
    try {
      const lines = await invokeStudioAgentChat(safeOutgoing, { mode: chatMode, history: historyTurns })
      const replyNow = Date.now()
      const dramaExpert =
        isDrama && dramaProjectTabId
          ? resolveActiveExpertForState(ensureDramaProductionState(dramaProjectTabId))
          : null
      const assistantChunks: StoredAiMessage[] = []
      for (const line of lines) {
        let t = replaceSensitiveWords(line.trim())
        if (!t) continue
        if (dramaExpert && !t.startsWith('【已执行】')) {
          t = formatDramaExpertReply(dramaExpert, t)
        }
        assistantChunks.push({ role: 'assistant', content: t, timestamp: replyNow })
      }
      if (!assistantChunks.length) {
        assistantChunks.push({ role: 'assistant', content: '好的。', timestamp: replyNow })
      }
      upsertSession(sid, (s) => ({
        ...s,
        messages: [...s.messages, ...assistantChunks],
        updatedAt: replyNow,
      }))
    } catch (e) {
      const errNow = Date.now()
      upsertSession(sid, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content: replaceSensitiveWords(`处理出错：${(e as Error)?.message || String(e)}`),
            timestamp: errNow,
          },
        ],
        updatedAt: errNow,
      }))
    } finally {
      setSending(false)
      sendInFlightRef.current = false
    }
  }, [
    canSend,
    input,
    currentSession.messages,
    currentSessionId,
    parseMode,
    upsertSession,
    isDrama,
    dramaProjectTabId,
    onDramaAutoRenameFromTheme,
  ])

  const dramaStageGenAskActive = useMemo(() => {
    if (!dramaAskUser) return false
    return (
      dramaAskUser.kind === 'stage_gen_choice' ||
      dramaAskUser.kind === 'image_gen_mode' ||
      isDramaStageGenChoiceAsk(dramaAskUser.question, dramaAskUser.options)
    )
  }, [dramaAskUser])

  const handleDramaAskUserPick = useCallback(
    (opt: string) => {
      if (dramaProjectTabId) {
        const pending = getDramaAskUserPending()
        if (
          pending &&
          (pending.kind === 'stage_gen_choice' ||
            pending.kind === 'image_gen_mode' ||
            isDramaStageGenChoiceAsk(pending.question, pending.options))
        ) {
          const stage: DramaGenStage =
            pending.stage ??
            peekPendingDramaStageGenAsk(dramaProjectTabId) ??
            'character_design'
          const parsed = parseDramaStageGenChoiceFromText(stage, opt)
          if (parsed) {
            setDramaAskUserPending(null)
            confirmDramaStageGenChoice(dramaProjectTabId, stage, parsed)
            resumeDramaPipelineAfterStageGenChoice(dramaProjectTabId)
            return
          }
        }
      }
      setDramaAskUserPending(null)
      const text = opt.startsWith('【用户选择】') ? opt : `【用户选择】${opt}`
      dramaAutoSendRef.current = text
      setInput(text)
    },
    [dramaProjectTabId],
  )

  useEffect(() => {
    if (!dramaAutoSendRef.current || input !== dramaAutoSendRef.current) return
    dramaAutoSendRef.current = null
    void handleSend()
  }, [input, handleSend])

  const dramaChatFeed = isDrama ? (
    <DramaAgentChatFeed
      messages={chatAreaMessages}
      steps={dramaSteps}
      events={dramaEvents}
      state={dramaState}
      uiState={dramaUi}
      sending={sending}
      askUser={dramaAskUser}
      askUserDisabled={blocked && !dramaStageGenAskActive}
      onAskUserPick={handleDramaAskUserPick}
    />
  ) : (
    <AgentWorkspaceChatArea messages={chatAreaMessages} variant="default" />
  )

  const dramaInputArea = (
    <DramaAgentInputArea
      value={input}
      onChange={setInput}
      onSend={() => void handleSend()}
      disabled={blocked}
      isHome={isHome}
      working={sending || dramaUi.characterGen.running || dramaUi.sceneGen.running}
    />
  )

  if (!open) return null

  const shellClass = isDrama
    ? 'drama-agent-chat flex h-full min-h-0 w-full flex-col overflow-hidden'
    : isSplit
      ? 'flex h-full min-h-0 w-full overflow-hidden bg-aw-page text-aw-text-main'
      : 'fixed inset-0 z-[12000] flex h-full w-full overflow-hidden bg-aw-page text-aw-text-main'

  return (
    <div
      className={shellClass}
      data-studio-agent-workspace="1"
      role={isSplit ? undefined : 'dialog'}
      aria-modal={isSplit ? undefined : true}
      aria-label="AI 助手工作台"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {isSplit && dramaProductionMode && !isDrama ? (
        <DramaAgentSideRail activeTab={dramaRailTab} onTabChange={onPickDramaRailTab} />
      ) : null}

      {!isSplit ? (
        <AgentWorkspaceSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          onOpenSessionSearch={() => {
            setSessionSearchOpen(true)
            setSessionSearchQuery('')
          }}
          projectItems={projectItems}
          sessionSections={sessionSections}
          currentSessionId={currentSessionId}
          onNewChat={onNewChat}
          onPickSession={onPickSession}
          onDeleteSession={onDeleteSession}
          onRenameSession={renameSession}
          tasks={tasks}
          onNavigateTask={navigateAgentCanvasToNode}
          onOpenProfile={() => setProfilePanelOpen(true)}
          canvasProjectTitle={canvasProjectTitle}
          onClearAllSessions={clearAllSessions}
        />
      ) : null}

      <main className={isDrama ? 'drama-agent-chat__main relative flex min-h-0 min-w-0 flex-1 flex-col' : 'relative flex min-h-0 min-w-0 flex-1 flex-col bg-white'}>
        {isDrama ? (
          <DramaAgentChatHeader
            title={dramaProjectTitle?.trim() || '剧情故事短片'}
            onRenameTitle={onRenameDramaProjectTitle}
          />
        ) : null}
        {!isDrama ? (
        <>
        <AgentWorkspaceTopBar
          title={
            dramaProductionMode && isSplit
              ? currentSession.title || 'AI 短剧制片'
              : currentSession.title
          }
          onRenameTitle={(next) => renameSession(currentSessionId, next)}
          onBackToCanvas={isSplit && onBackToCanvas ? onBackToCanvas : onClose}
          backLabel={isSplit && dramaProductionMode ? '节点画布' : '返回画布'}
          onDismissSplit={isSplit && onDismissSplit ? onDismissSplit : undefined}
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={() => setSidebarCollapsed(false)}
        />

        {sessionSearchOpen ? (
          <div className="absolute left-0 right-0 top-16 z-40 flex max-h-[min(72vh,560px)] flex-col border-b border-aw-border bg-white shadow-md">
            <div className="flex items-center gap-2 border-b border-aw-border px-3 py-2">
              <input
                autoFocus
                className="min-w-0 flex-1 rounded-md border border-aw-border px-3 py-2 text-[13px] text-aw-text-main outline-none placeholder:text-aw-text-sub/50 focus:ring-1 focus:ring-aw-text-sub/30"
                placeholder="搜索对话标题…"
                value={sessionSearchQuery}
                onChange={(e) => setSessionSearchQuery(e.target.value)}
                aria-label="搜索对话"
              />
              <button
                type="button"
                className="shrink-0 rounded-md border border-aw-border px-3 py-1.5 text-[12px] font-semibold text-aw-text-main hover:bg-aw-hover"
                onClick={() => {
                  setSessionSearchOpen(false)
                  setSessionSearchQuery('')
                }}
              >
                关闭
              </button>
            </div>
            <ul className="scrollbar-hide min-h-0 flex-1 overflow-y-auto py-2">
              {filteredSessionsForSearch.length === 0 ? (
                <li className="px-4 py-4 text-[13px] text-aw-text-sub">无匹配对话</li>
              ) : (
                filteredSessionsForSearch.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      title={s.title}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-aw-hover"
                      onClick={() => {
                        setCurrentSessionId(s.id)
                        setSessionSearchOpen(false)
                        setSessionSearchQuery('')
                      }}
                    >
                      <span className="min-w-0 flex-1 break-words font-medium leading-snug text-aw-text-main">
                        {s.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-aw-text-sub">
                        {new Date(s.updatedAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <p className="border-t border-aw-border px-4 py-2 text-center text-[11px] text-aw-text-sub">Esc 关闭</p>
          </div>
        ) : null}
        </>
        ) : null}

        {/* 不用 overflow-hidden：底部输入条上「向上展开」的模式菜单会伸入对话区，hidden 会把第一项裁掉 */}
        <div className={`relative flex min-h-0 flex-1 flex-col overflow-x-hidden${isDrama ? ' drama-agent-chat__stream' : ''}`}>
          {composerDocked ? (
            <>
              <div
                ref={listRef}
                className="agent-workspace-scroll min-h-0 flex-1 overflow-y-auto"
                data-drama-chat-selectable={isDrama ? '1' : undefined}
                onDragOver={handleMainFileDragOver}
                onDrop={(e) => void handleMainFileDrop(e)}
              >
                {dramaChatFeed}
              </div>
              {sending && !isDrama ? (
                <div className="pointer-events-none absolute bottom-32 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 px-10 py-4">
                  <div className="flex w-fit items-center gap-1.5 rounded-full border border-aw-border bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur">
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-aw-text-sub"
                      style={{ animationDelay: '0ms' }}
                    />
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-aw-text-sub"
                      style={{ animationDelay: '150ms' }}
                    />
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-aw-text-sub"
                      style={{ animationDelay: '300ms' }}
                    />
                    <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-aw-text-sub">
                      AI 正在思考
                    </span>
                  </div>
                </div>
              ) : null}
              {dramaAskUser && !isDrama ? (
                <motion.div
                  className="mx-10 mb-3 rounded-2xl border border-orange-200 bg-orange-50/90 px-4 py-3 shadow-sm"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <p className="text-[13px] font-bold text-orange-950/90 mb-2">{dramaAskUser.question}</p>
                  <div className="flex flex-wrap gap-2">
                    {dramaAskUser.options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        disabled={blocked}
                        className="rounded-full border border-orange-300/80 bg-white px-3 py-1.5 text-[12px] font-bold text-orange-900 hover:bg-orange-600 hover:text-white transition-colors disabled:opacity-50"
                        onClick={() => {
                          setDramaAskUserPending(null)
                          setInput(`【用户选择】${opt}`)
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : null}
              {isDrama ? dramaInputArea : (
              <AgentWorkspaceInputArea
                value={input}
                onChange={setInput}
                onSend={() => void handleSend()}
                disabled={blocked}
                isHome={isHome}
                layout="dock"
                parseMode={parseMode}
                onParseModeChange={onPickParseMode}
                modeBanner={modeSwitchHint}
                assistantModelName={assistantModelName}
              />
              )}
            </>
          ) : (
            <div
              ref={listRef}
              className={`agent-workspace-scroll flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8${
                chatAreaMessages.length > 0 ? ' gap-8' : ''
              }`}
              data-drama-chat-selectable={isDrama ? '1' : undefined}
              onDragOver={handleMainFileDragOver}
              onDrop={(e) => void handleMainFileDrop(e)}
            >
              {chatAreaMessages.length > 0 ? (
                <div className={`w-full shrink-0${isDrama ? '' : ' max-w-3xl'}`}>
                  {isDrama ? dramaChatFeed : (
                    <AgentWorkspaceChatArea messages={chatAreaMessages} compact />
                  )}
                </div>
              ) : null}
              {sending && !isDrama ? (
                <div className="flex shrink-0 justify-center px-4 py-2">
                  <div className="flex w-fit items-center gap-1.5 rounded-full border border-aw-border bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur">
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-aw-text-sub"
                      style={{ animationDelay: '0ms' }}
                    />
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-aw-text-sub"
                      style={{ animationDelay: '150ms' }}
                    />
                    <div
                      className="h-1 w-1 animate-bounce rounded-full bg-aw-text-sub"
                      style={{ animationDelay: '300ms' }}
                    />
                    <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-aw-text-sub">
                      AI 正在思考
                    </span>
                  </div>
                </div>
              ) : null}
              {isDrama ? (
                <div className={`drama-agent-input-wrap${isHome ? ' drama-agent-input-wrap--home' : ''}`}>
                  {dramaInputArea}
                </div>
              ) : (
              <AgentWorkspaceInputArea
                value={input}
                onChange={setInput}
                onSend={() => void handleSend()}
                disabled={blocked}
                isHome={isHome}
                layout="center"
                parseMode={parseMode}
                onParseModeChange={onPickParseMode}
                modeBanner={modeSwitchHint}
                assistantModelName={assistantModelName}
              />
              )}
            </div>
          )}
        </div>
      </main>

      {profilePanelOpen ? (
        <div
          className="fixed inset-0 z-[12500] flex items-center justify-center bg-black/35 p-4"
          role="presentation"
          onMouseDown={() => setProfilePanelOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-aw-border bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="个人信息"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="text-[15px] font-semibold text-aw-text-main">个人信息</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-aw-text-sub">
              头像上传、昵称编辑与积分余额将在此展示；「本地工作室」将用于显示积分余额。
            </p>
            <p className="mt-1 text-[12px] text-aw-text-sub/80">当前为占位界面。</p>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-aw-border py-2 text-[13px] font-semibold text-aw-text-main transition-colors hover:bg-aw-hover"
              onClick={() => setProfilePanelOpen(false)}
            >
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
