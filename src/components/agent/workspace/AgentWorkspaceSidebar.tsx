import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Trash2,
  ShoppingBag,
  TextQuote,
  Video,
  X,
} from 'lucide-react'
import type { AgentCanvasTaskItem } from '../../../lib/agentCanvasBridge'
import type { AgentProjectContextItem } from '../../../lib/agentProjectContextBridge'
import { requestAgentOpenCanvasSettings } from '../../../lib/agentStudioUiBridge'
import type { AiSession } from '../../../lib/aiSessionsStorage'

const DT_FLOWID_NODE = 'application/x-flowid-node'
const DT_FLOWID_PROJECT = 'application/x-flowid-project'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i

function projectDragTabId(itemId: string): string | undefined {
  const raw = itemId.startsWith('tab:') ? itemId.slice(4) : itemId
  return UUID_RE.test(raw) ? raw : undefined
}

type SessionSection = { title: string; items: AiSession[] }

function formatSessionRowTime(updatedAt: number, now = Date.now()): string {
  const d = new Date(updatedAt)
  const t0 = new Date(now)
  t0.setHours(0, 0, 0, 0)
  const t1 = new Date(t0.getTime() - 86400000)
  const u = new Date(updatedAt)
  u.setHours(0, 0, 0, 0)
  if (u.getTime() >= t0.getTime()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (u.getTime() >= t1.getTime()) return '昨天'
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

type TaskStatusVisual = 'completed' | 'failed' | 'waiting' | 'running'

function taskRunVisual(t: AgentCanvasTaskItem): TaskStatusVisual {
  if (t.runStatus === 'success') return 'completed'
  if (t.runStatus === 'error') return 'failed'
  if (t.runStatus === 'running') return 'running'
  return 'waiting'
}

function StatusIcon({ status }: { status: TaskStatusVisual }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
    case 'waiting':
      return <Clock className="h-3.5 w-3.5 text-gray-400" />
    default:
      return <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
  }
}

function NodeKindIcon({ kind }: { kind: string }) {
  if (kind === 'video') return <Video className="h-3.5 w-3.5" />
  if (kind === 'image' || kind === 'panorama') return <ImageIcon className="h-3.5 w-3.5" />
  if (kind === 'text' || kind === 'script') return <TextQuote className="h-3.5 w-3.5" />
  if (kind === 'group') return <LayoutGrid className="h-3.5 w-3.5" />
  return <Layers className="h-3.5 w-3.5" />
}

type Props = {
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenSessionSearch: () => void
  /** 当前工程与镜像 JSON 等（来自 Studio 注册） */
  projectItems: AgentProjectContextItem[]
  sessionSections: SessionSection[]
  currentSessionId: string
  onNewChat: () => void
  onPickSession: (id: string) => void
  onDeleteSession: (e: ReactMouseEvent, id: string) => void
  onRenameSession: (id: string, title: string) => void
  tasks: AgentCanvasTaskItem[]
  onNavigateTask: (nodeId: string) => void
  /** 点击底部头像区域：个人信息面板（占位） */
  onOpenProfile?: () => void
  /** 画布节点区：当前对话框关联的工程名称（展开后列出节点状态） */
  canvasProjectTitle: string
  /** 清空全部会话记录（侧栏所有会话移除后新建一条空白会话） */
  onClearAllSessions: () => void
}

/**
 * 侧栏：原型布局 + 真实会话列表 + 可折叠画布节点。
 */
export function AgentWorkspaceSidebar({
  collapsed,
  onToggleCollapsed,
  onOpenSessionSearch,
  projectItems,
  sessionSections,
  currentSessionId,
  onNewChat,
  onPickSession,
  onDeleteSession,
  onRenameSession,
  tasks,
  onNavigateTask,
  onOpenProfile,
  canvasProjectTitle,
  onClearAllSessions,
}: Props) {
  /** 项目名称下展开画布各节点执行状态 */
  const [canvasProjectExpanded, setCanvasProjectExpanded] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreWrapRef = useRef<HTMLDivElement>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renamingId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingId])

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: Event) => {
      const el = moreWrapRef.current
      const t = e.target
      if (el && t instanceof Node && !el.contains(t)) setMoreOpen(false)
    }
    // 捕获阶段：工作台根层会 stopPropagation，冒泡到 document 的监听收不到侧栏外的点击
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [moreOpen])

  const commitRename = (sessionId: string, fallbackTitle: string) => {
    const next = renameDraft.trim() || fallbackTitle
    onRenameSession(sessionId, next)
    setRenamingId(null)
  }

  return (
    <div
      className={`relative flex h-screen shrink-0 select-none flex-col overflow-hidden border-r border-aw-border bg-aw-sidebar transition-[width,opacity] duration-200 ease-out ${
        collapsed ? 'w-0 min-w-0 border-transparent opacity-0' : 'w-64 opacity-100'
      }`}
      aria-hidden={collapsed}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          className="rounded p-0.5 text-aw-text-sub transition-colors hover:bg-aw-hover hover:text-aw-text-main"
          aria-label="收起侧栏"
          title="收起侧栏"
          onClick={onToggleCollapsed}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded p-0.5 text-aw-text-sub transition-colors hover:bg-aw-hover hover:text-aw-text-main"
          aria-label="搜索对话"
          title="搜索对话"
          onClick={onOpenSessionSearch}
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="ml-auto rounded p-0.5 text-aw-text-sub transition-colors hover:bg-aw-hover hover:text-red-600/90"
          aria-label="清空全部会话记录"
          title="清空全部会话记录（移除侧栏所有会话与消息，并新建一条空白会话）"
          onClick={() => onClearAllSessions()}
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="mb-4 space-y-0.5 px-2">
        <button
          type="button"
          className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-aw-hover"
          onClick={onNewChat}
        >
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-aw-text-sub" />
            <span className="text-[13px] font-medium text-aw-text-main">新建助手</span>
          </div>
          <span className="font-mono text-[10px] text-aw-text-sub opacity-0 transition-opacity group-hover:opacity-100">
            Ctrl+N
          </span>
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-aw-hover"
          title="即将推出"
        >
          <ShoppingBag className="h-4 w-4 text-aw-text-sub" />
          <span className="text-[13px] font-medium text-aw-text-main">应用市场</span>
        </button>
      </div>

      <div className="scrollbar-hide flex-1 overflow-y-auto px-2 pb-32">
        <div className="mt-0">
          <div className="mb-1 flex items-center gap-1 px-2 text-[10px] font-bold uppercase tracking-wider text-aw-text-sub/50">
            当前项目
          </div>
          <div className="space-y-1">
            {(projectItems.length ? projectItems : [{ id: 'empty', label: '（未接入工程信息）' }]).map((item) => (
              <div
                key={item.id}
                draggable={item.id !== 'empty'}
                onDragStart={(e: ReactDragEvent) => {
                  if (item.id === 'empty') return
                  const tabId = projectDragTabId(item.id)
                  e.dataTransfer.setData(
                    DT_FLOWID_PROJECT,
                    JSON.stringify({ label: item.label, ...(tabId ? { tabId } : {}) }),
                  )
                  e.dataTransfer.setData('text/plain', item.label)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                className={`group flex items-start gap-2 rounded-md px-2 py-1 transition-colors hover:bg-aw-hover ${
                  item.id === 'empty' ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                }`}
                title={
                  item.id === 'empty'
                    ? item.description
                    : `${item.description ? `${item.description}\n` : ''}拖到输入框：插入 @ 项目引用`
                }
              >
                <div
                  className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${item.isActive ? 'bg-aw-text-sub/50' : 'bg-aw-text-sub/30'}`}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-[12px] text-aw-text-sub group-hover:text-aw-text-main ${item.isActive ? 'font-semibold' : ''}`}
                  >
                    {item.label}
                  </div>
                  {item.description ? (
                    <div className="line-clamp-2 text-[10px] leading-snug text-aw-text-sub/75">{item.description}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {sessionSections.map((section) => (
          <div key={section.title} className="mt-4">
            <div className="mb-1 px-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-aw-text-sub/50">
                {section.title}
              </span>
            </div>
            <div className="space-y-0.5">
              {section.items.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  title={s.title}
                  className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-aw-hover ${
                    s.id === currentSessionId ? 'bg-aw-hover' : ''
                  }`}
                  onClick={() => {
                    if (renamingId === s.id) return
                    onPickSession(s.id)
                  }}
                  onDoubleClick={(ev) => {
                    ev.preventDefault()
                    setRenamingId(s.id)
                    setRenameDraft(s.title)
                  }}
                  onKeyDown={(ev) => {
                    if (renamingId === s.id) return
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      onPickSession(s.id)
                    }
                  }}
                >
                  <div className="h-1 w-1 shrink-0 rounded-full bg-aw-text-sub/20" />
                  {renamingId === s.id ? (
                    <input
                      ref={renameInputRef}
                      className="min-w-0 flex-1 rounded border border-aw-border bg-white px-1.5 py-0.5 text-[12px] text-aw-text-main outline-none focus:ring-1 focus:ring-aw-text-sub/30"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onBlur={() => commitRename(s.id, s.title)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitRename(s.id, s.title)
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setRenamingId(null)
                        }
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 break-words text-[12px] leading-snug text-aw-text-sub group-hover:text-aw-text-main">
                      {s.title}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-aw-text-sub/70">{formatSessionRowTime(s.updatedAt)}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-aw-text-sub/60 opacity-0 transition-opacity hover:bg-aw-hover hover:text-aw-text-main group-hover:opacity-100"
                    title="删除此会话"
                    aria-label="删除此会话"
                    onClick={(ev) => onDeleteSession(ev, s.id)}
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-6">
          <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-aw-text-sub/50">画布节点</div>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-aw-hover"
            onClick={() => setCanvasProjectExpanded((v) => !v)}
            aria-expanded={canvasProjectExpanded}
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-aw-text-main">{canvasProjectTitle}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-aw-text-sub transition-transform ${canvasProjectExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          <AnimatePresence>
            {canvasProjectExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-0.5 overflow-hidden pl-1"
              >
                {tasks.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-aw-text-sub/80">暂无节点</p>
                ) : (
                  tasks.map((node) => (
                    <button
                      key={node.nodeId}
                      type="button"
                      draggable
                      title="点击定位画布；拖到输入框：插入 @ 节点引用"
                      onDragStart={(e: ReactDragEvent) => {
                        e.stopPropagation()
                        e.dataTransfer.setData(DT_FLOWID_NODE, JSON.stringify({ nodeId: node.nodeId, title: node.title }))
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      className="group flex w-full cursor-grab items-center justify-between rounded-md px-2 py-1 text-left transition-colors hover:bg-aw-hover active:cursor-grabbing"
                      onClick={() => onNavigateTask(node.nodeId)}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
                        <NodeKindIcon kind={node.kind} />
                        <span className="truncate text-[11px] text-aw-text-sub">{node.title}</span>
                      </div>
                      <StatusIcon status={taskRunVisual(node)} />
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 flex w-full items-center justify-between border-t border-aw-border bg-aw-sidebar p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left transition-colors hover:bg-aw-hover/80"
          onClick={() => onOpenProfile?.()}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-aw-border bg-gray-200 text-[10px] font-bold text-aw-text-sub">
            FD
          </div>
          <div className="-space-y-1 flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[12px] font-semibold text-aw-text-main">FlowID</span>
            <span className="truncate text-[10px] text-aw-text-sub">本地工作室</span>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="rounded p-0.5 text-aw-text-sub transition-colors hover:bg-aw-hover hover:text-aw-text-main"
            title="画布设置（与左侧设置面板同步）"
            aria-label="打开画布设置"
            onClick={() => requestAgentOpenCanvasSettings()}
          >
            <Settings className="h-4 w-4" />
          </button>
          <div ref={moreWrapRef} className="relative">
            <button
              type="button"
              className="rounded p-0.5 text-aw-text-sub transition-colors hover:bg-aw-hover hover:text-aw-text-main"
              title="更多"
              aria-label="更多"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {moreOpen ? (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-44 rounded-md border border-aw-border bg-white py-2 shadow-lg">
                <p className="px-3 py-1 text-[11px] leading-snug text-aw-text-sub">更多选项占位，后续接入。</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
