import { motion } from 'motion/react'
import type { ClipboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { copyNeedsSanitize, sanitizeChatCopySelection } from '../../../lib/agentClipboardSanitize'

export type AgentWorkspaceChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type Props = {
  messages: AgentWorkspaceChatMessage[]
  /** 首屏与输入框一起居中时收紧上下留白 */
  compact?: boolean
  /** drama = 短剧深色气泡样式 */
  variant?: 'default' | 'drama'
}

/**
 * 对话区：USER/ASSISTANT 标签 + Markdown（助手）/ 纯文本（用户）。
 */
function onBubbleCopy(e: ClipboardEvent<HTMLDivElement>) {
  const sel = typeof window !== 'undefined' ? (window.getSelection()?.toString() ?? '') : ''
  if (!sel.trim()) return
  if (!copyNeedsSanitize(sel)) return
  e.preventDefault()
  e.clipboardData?.setData('text/plain', sanitizeChatCopySelection(sel))
}

export function AgentWorkspaceChatArea({ messages, compact, variant = 'default' }: Props) {
  const isDrama = variant === 'drama'
  const innerPad = compact ? 'space-y-6 py-4 pb-4' : isDrama ? 'space-y-5 py-4 pb-32' : 'space-y-8 py-10 pb-40'

  return (
    <div className={compact ? 'px-4 pb-2 pt-0' : isDrama ? 'px-4 pb-2 pt-0' : 'px-6 pb-4 pt-2'}>
      {messages.length === 0 ? (
        <div className={isDrama ? 'min-h-[30vh]' : 'min-h-[40vh]'} />
      ) : (
        <div className={`mx-auto w-full ${isDrama ? 'max-w-none' : 'max-w-3xl'} ${innerPad}`}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex w-full min-w-0 max-w-full flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {!isDrama ? (
                <div
                  className={`mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${
                    msg.role === 'user' ? 'pr-2 text-aw-text-sub' : 'pl-2 text-aw-text-sub'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <>
                      <span>用户</span>
                      <div className="h-1 w-1 rounded-full bg-aw-text-sub/30" />
                      <span>USER</span>
                    </>
                  ) : (
                    <>
                      <div className="h-1 w-1 rounded-full bg-aw-text-sub/30" />
                      <span>助手</span>
                      <div className="h-1 w-1 rounded-full bg-aw-text-sub/30" />
                      <span>ASSISTANT</span>
                    </>
                  )}
                </div>
              ) : null}
              <div
                className={
                  isDrama
                    ? `agent-workspace-msg agent-workspace-msg--${msg.role} min-w-0 max-w-[92%] px-4 py-3 text-[14px] leading-relaxed [overflow-wrap:anywhere]`
                    : `min-w-0 w-full max-w-[92%] rounded-2xl px-5 py-4 text-[14px] leading-relaxed shadow-sm [overflow-wrap:anywhere] ${
                        msg.role === 'user'
                          ? 'border border-aw-border/80 bg-aw-user-bg font-medium text-aw-user-fg'
                          : 'border border-aw-border bg-aw-ai-bg text-aw-text-main'
                      }`
                }
              >
                {msg.role === 'user' ? (
                  <div className="select-text whitespace-pre-wrap break-words" onCopy={onBubbleCopy}>
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className={`aw-markdown select-text break-words [&_a]:text-blue-400 [&_a]:underline [&_code]:block [&_code]:max-w-full [&_code]:overflow-x-auto [&_code]:rounded [&_code]:px-1 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${
                      isDrama ? 'text-[#d4d4dc]' : 'text-aw-text-main [&_code]:bg-black/5'
                    }`}
                    onCopy={onBubbleCopy}
                  >
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
