import { useEffect, useRef, useState } from 'react'

type Props = {
  /** 当前项目名称（顶栏展示） */
  title?: string
  /** 双击重命名后提交，同步项目标签名 */
  onRenameTitle?: (next: string) => void
}

/**
 * 短剧 Agent 对话顶栏：项目名称，双击可重命名。
 */
export function DramaAgentChatHeader({
  title = '剧情故事短片',
  onRenameTitle,
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

  /** 提交重命名 */
  const commit = () => {
    const next = draft.trim() || '未命名项目'
    onRenameTitle?.(next)
    setEditing(false)
  }

  /** 取消编辑 */
  const cancel = () => {
    setDraft(title)
    setEditing(false)
  }

  return (
    <header className="drama-agent-chat-header">
      {editing && onRenameTitle ? (
        <input
          ref={inputRef}
          className="drama-agent-chat-header__title-input"
          value={draft}
          aria-label="编辑项目名称"
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
        <p
          className={`drama-agent-chat-header__title${onRenameTitle ? ' is-editable' : ''}`}
          title={onRenameTitle ? `${title}（双击重命名）` : title}
          onDoubleClick={() => {
            if (onRenameTitle) setEditing(true)
          }}
        >
          {title}
        </p>
      )}
    </header>
  )
}
