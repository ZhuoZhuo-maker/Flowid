import { useMemo, useState } from 'react'

export type AiAssistantMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
}

export function AiAssistantPanel({
  messages,
  busy,
  onSend,
  onClose,
}: {
  messages: AiAssistantMessage[]
  busy: boolean
  onSend: (text: string) => Promise<void>
  onClose: () => void
}) {
  const [input, setInput] = useState('')
  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy])

  return (
    <div className="ai-assistant-panel">
      <div className="ai-assistant-panel__head">
        <h2 className="ai-assistant-panel__title">AI 助手（MVP）</h2>
        <button type="button" className="ai-assistant-panel__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <p className="ai-assistant-panel__hint">
        支持：新建节点、按标题连线、执行节点。示例：新建一个图片节点；连接「剧本」到「图片」；执行「图片节点1」。
      </p>
      <div className="ai-assistant-panel__list" aria-label="AI 对话记录">
        {messages.length ? (
          messages.map((m) => (
            <div key={m.id} className={`ai-assistant-panel__msg ai-assistant-panel__msg--${m.role}`}>
              <span className="ai-assistant-panel__role">
                {m.role === 'user' ? '你' : m.role === 'assistant' ? '助手' : '系统'}
              </span>
              <span>{m.text}</span>
            </div>
          ))
        ) : (
          <div className="ai-assistant-panel__empty">发送一句话开始，例如：新建一个视频节点。</div>
        )}
      </div>
      <div className="ai-assistant-panel__composer">
        <textarea
          className="ai-assistant-panel__input"
          placeholder="输入你的目标，例如：新建文本节点并连接到图片节点1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!canSend) return
              const text = input.trim()
              setInput('')
              void onSend(text)
            }
          }}
        />
        <button
          type="button"
          className="btn btn--chip btn--chip-light"
          disabled={!canSend}
          onClick={() => {
            if (!canSend) return
            const text = input.trim()
            setInput('')
            void onSend(text)
          }}
        >
          {busy ? '处理中…' : '发送'}
        </button>
      </div>
    </div>
  )
}

