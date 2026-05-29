import { useCallback, useRef, type KeyboardEvent } from 'react'
import { ArrowUp, FileText, Globe, Plus, UserRound } from 'lucide-react'

type Props = {
  value: string
  onChange: (next: string) => void
  onSend: () => void
  disabled: boolean
  /** 图一初始占位；有对话后切换为拖拽提示 */
  isHome?: boolean
  /** Agent 工作中时隐藏输入，仅显示工作中条 */
  working?: boolean
}

const HOME_PLACEHOLDER =
  '故事短片 / 一个转学生来到异世界高中，发现同学们都有各种超能力'

const DOCK_PLACEHOLDER = '拖拽/粘贴 🖼️ 图片到这里，来试试【角色】、【风格】参考'

/**
 * 短剧 Agent 底部输入条：上方输入、下方工具栏 + 发送。
 */
export function DramaAgentInputArea({
  value,
  onChange,
  onSend,
  disabled,
  isHome,
  working,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter' || e.shiftKey) return
      e.preventDefault()
      if (!disabled && value.trim()) onSend()
    },
    [disabled, onSend, value],
  )

  if (working) return null

  const placeholder = isHome ? HOME_PLACEHOLDER : DOCK_PLACEHOLDER

  return (
    <div className={`drama-agent-input${isHome ? ' drama-agent-input--home' : ''}`}>
      <div className="drama-agent-input__box">
        <textarea
          ref={textareaRef}
          className="drama-agent-input__textarea"
          rows={2}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="短剧 Agent 输入"
        />
        <div className="drama-agent-input__toolbar">
          <button type="button" className="drama-agent-input__tool" title="添加" aria-label="添加">
            <Plus size={16} />
          </button>
          <button type="button" className="drama-agent-input__tool" title="剧本" aria-label="剧本">
            <FileText size={15} />
            <span className="drama-agent-input__tool-label">剧本</span>
          </button>
          <button type="button" className="drama-agent-input__tool" title="角色" aria-label="角色">
            <UserRound size={15} />
          </button>
          <button type="button" className="drama-agent-input__tool" title="风格" aria-label="风格">
            <Globe size={15} />
          </button>
          <button
            type="button"
            className="drama-agent-input__send"
            disabled={disabled || !value.trim()}
            title="发送"
            aria-label="发送"
            onClick={() => {
              if (!disabled && value.trim()) onSend()
            }}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
