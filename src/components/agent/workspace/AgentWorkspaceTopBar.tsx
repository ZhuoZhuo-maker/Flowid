import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

type Props = {
  /** 当前选中会话标题（替代「助手工作台」） */
  title: string
  /** 双击标题重命名后提交，与侧栏会话列表同步 */
  onRenameTitle: (next: string) => void
  onBackToCanvas: () => void
  /** 侧栏收起时在顶栏左侧显示展开按钮 */
  sidebarCollapsed: boolean
  onExpandSidebar: () => void
}

/**
 * 顶栏：左侧会话名（可截断，双击可改名）；右侧「返回画布」。侧栏收起时左侧出现展开。
 */
export function AgentWorkspaceTopBar({
  title,
  onRenameTitle,
  onBackToCanvas,
  sidebarCollapsed,
  onExpandSidebar,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const commit = () => {
    const next = draft.trim() || '未命名对话'
    onRenameTitle(next)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(title)
    setEditing(false)
  }

  return (
    <div className="flex min-h-10 shrink-0 select-none items-start justify-between gap-3 border-b border-aw-border bg-aw-sidebar px-3 py-2">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {sidebarCollapsed ? (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-aw-border text-aw-text-sub transition-colors hover:bg-aw-hover hover:text-aw-text-main"
            aria-label="展开侧栏"
            title="展开侧栏"
            onClick={onExpandSidebar}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
        {editing ? (
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded border border-aw-border bg-white px-2 py-1 text-[13px] font-semibold text-aw-text-main outline-none focus:ring-1 focus:ring-aw-text-sub/30"
            value={draft}
            aria-label="编辑对话标题"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          />
        ) : (
          <span
            className="min-w-0 flex-1 cursor-text break-words text-[13px] font-semibold leading-snug text-aw-text-main"
            title={`${title}（双击重命名，与侧栏同步）`}
            onDoubleClick={() => setEditing(true)}
          >
            {title}
          </span>
        )}
      </div>
      <button
        type="button"
        className="mt-0.5 shrink-0 self-start rounded-lg border border-aw-border bg-aw-page px-3 py-1.5 text-[12px] font-semibold text-aw-text-main shadow-sm transition-colors hover:bg-aw-hover"
        onClick={onBackToCanvas}
      >
        返回画布
      </button>
    </div>
  )
}
