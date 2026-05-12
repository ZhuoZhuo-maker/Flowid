import { NodeResizer } from '@xyflow/react'
import { useEffect, useState, type ReactNode } from 'react'
import type { NodeRunProgress, NodeRunStatus } from '../../types'

/**
 * 节点外壳：统一标题栏、选中态、执行进度与内容区，贴近「专业画布」深色风格。
 */
export function NodeChrome({
  icon,
  title,
  accent,
  runStatus,
  runProgress,
  editableTitle = false,
  onTitleChange,
  showStatusBadge = false,
  selected,
  children,
  footer,
}: {
  icon: ReactNode
  title: string
  /** CSS 颜色，用于左边条强调 */
  accent: string
  runStatus?: NodeRunStatus
  /** 与 Comfy 队列/历史轮询对应的近似进度（0–100） */
  runProgress?: NodeRunProgress
  /** 是否允许双击标题重命名 */
  editableTitle?: boolean
  /** 标题保存回调 */
  onTitleChange?: (nextTitle: string) => void
  /** 为 false 时隐藏标题栏状态词（如音乐节点），仍可用 runStatus 驱动进度条显隐 */
  showStatusBadge?: boolean
  selected?: boolean
  children: ReactNode
  /** 节点主体下方的附加区（如输出缩略图条） */
  footer?: ReactNode
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const status = runStatus ?? 'idle'
  const pct =
    runProgress != null
      ? Math.min(100, Math.max(0, Math.round(runProgress.percent)))
      : null
  const showProgress = pct != null && status !== 'success' && status !== 'error'

  useEffect(() => {
    if (!isEditingTitle) {
      setDraftTitle(title)
    }
  }, [isEditingTitle, title])

  /**
   * 提交标题修改：空值时回退原标题，避免节点出现空名称。
   */
  const commitTitleChange = () => {
    const next = draftTitle.trim()
    const raw = String(title ?? '')
    const fallback = raw.trim()
    const finalTitle = next || fallback || raw
    // 始终交给上层：画布内标题去重在 `StudioApp.updateNodeData`（与 `finalTitle === title` 时仍需处理重名）。
    if (onTitleChange) {
      onTitleChange(finalTitle)
    }
    setIsEditingTitle(false)
  }

  return (
    <div
      className={`studio-node ${selected ? 'studio-node--selected' : ''}`}
      style={{ '--node-accent': accent } as React.CSSProperties}
    >
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={280}
        minHeight={120}
        handleClassName="studio-node__resizerHandle"
        lineClassName="studio-node__resizerLine"
      />
      <header className="studio-node__head">
        <span className="studio-node__icon" aria-hidden>
          {icon}
        </span>
        {editableTitle && isEditingTitle ? (
          <input
            className="studio-node__titleInput nodrag"
            value={draftTitle}
            autoFocus
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitTitleChange}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTitleChange()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setDraftTitle(title)
                setIsEditingTitle(false)
              }
            }}
            aria-label="编辑节点标题"
          />
        ) : (
          <button
            type="button"
            className={`studio-node__title ${editableTitle ? 'studio-node__title--editable' : ''}`}
            title={editableTitle ? '双击重命名节点' : title}
            onDoubleClick={() => {
              if (!editableTitle) return
              setDraftTitle(title)
              setIsEditingTitle(true)
            }}
          >
            {title}
          </button>
        )}
        <div className="studio-node__headTrail">
          {showStatusBadge ? (
            <span className={`studio-node__status studio-node__status--${status}`}>
              {status === 'idle' ? null : status}
            </span>
          ) : null}
        </div>
      </header>
      {showProgress ? (
        <div
          className="studio-node__progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={runProgress?.label ?? '任务进度'}
        >
          <div className="studio-node__progressMeta">
            <span className="studio-node__progressLabel">{runProgress?.label ?? '执行中'}</span>
            <span className="studio-node__progressPct">{pct}%</span>
          </div>
          <div className="studio-node__progressTrack">
            <div className="studio-node__progressFill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
      <div className="studio-node__body">{children}</div>
      {footer}
    </div>
  )
}
