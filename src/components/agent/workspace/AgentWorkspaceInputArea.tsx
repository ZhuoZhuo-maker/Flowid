import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { ChevronDown, Keyboard, Monitor, Plus, Send } from 'lucide-react'
import { fileToInputSnippet } from '../../../lib/agentDroppedFileSnippets'
import {
  AGENT_PARSE_MODE_OPTIONS,
  type AgentParseMode,
} from '../../../lib/agentParseMode'
import { buildMentionToken } from '../../../lib/nodeMentions'

const DT_FLOWID_NODE = 'application/x-flowid-node'
const DT_FLOWID_PROJECT = 'application/x-flowid-project'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i

/** `center`：新会话首屏，与欢迎语一起在视区中部；`dock`：有输入或已有对话后贴底悬浮 */
export type AgentWorkspaceInputLayout = 'center' | 'dock'

type Props = {
  value: string
  onChange: (next: string) => void
  onSend: () => void
  disabled: boolean
  isHome: boolean
  layout: AgentWorkspaceInputLayout
  parseMode: AgentParseMode
  onParseModeChange: (m: AgentParseMode) => void
  modeBanner: string | null
  /** 设置里「AI 虚拟助手」的模型名，展示在模式按钮上 */
  assistantModelName?: string
}

/**
 * 底部悬浮输入（原型布局）：模式菜单、发送；语音占位。
 */
export function AgentWorkspaceInputArea({
  value,
  onChange,
  onSend,
  disabled,
  isHome,
  layout,
  parseMode,
  onParseModeChange,
  modeBanner,
  assistantModelName = '',
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [modeOpen, setModeOpen] = useState(false)
  const modeRootRef = useRef<HTMLDivElement>(null)

  const modelDisplay = useMemo(
    () => (assistantModelName ?? '').trim() || '未配置',
    [assistantModelName],
  )
  const modeButtonTitle = useMemo(() => {
    if (parseMode === 'rules') {
      return `规则引擎 · 当前模型 ${modelDisplay}（规划等会使用该模型）`
    }
    return `智能对话 · 当前模型 ${modelDisplay}（与设置中一致）`
  }, [parseMode, modelDisplay])

  const modeMenuRowLabel = useCallback(
    (value: AgentParseMode) =>
      value === 'rules'
        ? `自动 · 规则引擎（快速，本地）`
        : `智能对话 · ${modelDisplay}`,
    [modelDisplay],
  )

  const modeMenuRowTitle = useCallback(
    (value: AgentParseMode) =>
      value === 'rules'
        ? '与底部「自动」一致：指令由本地规则解析；复杂规划仍会请求设置中的模型。'
        : `与「设置 → AI 虚拟助手」使用同一模型：${modelDisplay}`,
    [modelDisplay],
  )

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  useEffect(() => {
    if (!modeOpen) return
    const onDown = (e: globalThis.MouseEvent) => {
      const root = modeRootRef.current
      if (root && e.target instanceof Node && root.contains(e.target)) return
      setModeOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [modeOpen])

  const insertAtCursor = useCallback(
    (snippet: string) => {
      const el = textareaRef.current
      const sn = snippet
      if (!el) {
        onChange(value ? `${value.replace(/\s+$/, '')}\n${sn}` : sn)
        return
      }
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      const before = value.slice(0, start)
      const after = value.slice(end)
      const needNl = before.length > 0 && !/\s$/.test(before) && !sn.startsWith('\n')
      const merged = before + (needNl ? '\n' : '') + sn + after
      onChange(merged)
      const pos = (before + (needNl ? '\n' : '') + sn).length
      queueMicrotask(() => {
        const t = textareaRef.current
        if (!t) return
        t.focus()
        t.selectionStart = t.selectionEnd = pos
      })
    },
    [onChange, value],
  )

  /** 拖放落在输入区外壳上时，若光标从未进入过 textarea，selection 可能为 0；插入后仍把焦点拉回输入框。 */
  const insertAtCursorPreferEnd = useCallback(
    (snippet: string) => {
      const el = textareaRef.current
      const sn = snippet.trim()
      if (!sn) return
      if (!el || document.activeElement !== el) {
        const t = value.replace(/\s+$/, '')
        const merged = t ? `${t}${/\s$/.test(t) ? '' : ' '}${sn}` : sn
        onChange(merged)
        queueMicrotask(() => {
          const ta = textareaRef.current
          if (!ta) return
          ta.focus()
          const pos = merged.length
          ta.selectionStart = ta.selectionEnd = pos
        })
        return
      }
      insertAtCursor(sn)
    },
    [insertAtCursor, onChange, value],
  )

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && value.trim()) onSend()
    }
  }

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (disabled) return
    const types = Array.from(e.dataTransfer.types)
    const hasFlow = types.includes(DT_FLOWID_NODE) || types.includes(DT_FLOWID_PROJECT)
    const hasFiles = types.includes('Files')
    if (!hasFlow && !hasFiles) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = async (e: DragEvent<HTMLElement>) => {
    if (disabled) return

    const nodeRaw = e.dataTransfer.getData(DT_FLOWID_NODE)
    if (nodeRaw) {
      e.preventDefault()
      e.stopPropagation()
      try {
        const o = JSON.parse(nodeRaw) as { nodeId?: string; title?: string }
        if (o?.nodeId && o.title != null) {
          insertAtCursorPreferEnd(buildMentionToken(String(o.title), String(o.nodeId)))
        }
      } catch {
        /* ignore */
      }
      return
    }
    const projRaw = e.dataTransfer.getData(DT_FLOWID_PROJECT)
    if (projRaw) {
      e.preventDefault()
      e.stopPropagation()
      try {
        const o = JSON.parse(projRaw) as { label?: string; tabId?: string }
        if (!o?.label) return
        const label = String(o.label).trim()
        if (!label) return
        const tid = typeof o.tabId === 'string' ? o.tabId.trim() : ''
        if (UUID_RE.test(tid)) {
          insertAtCursorPreferEnd(buildMentionToken(label, tid))
        } else {
          insertAtCursorPreferEnd(`@[${label}]`)
        }
      } catch {
        /* ignore */
      }
      return
    }

    const fl = e.dataTransfer.files
    if (fl && fl.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i]
        if (!f || f.size === 0) continue
        const snippet = await fileToInputSnippet(f)
        insertAtCursor(snippet)
      }
    }
  }

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return
    const files = e.clipboardData?.files
    if (!files?.length) return
    e.preventDefault()
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (!f || f.size === 0) continue
      const snippet = await fileToInputSnippet(f)
      insertAtCursor(snippet)
    }
  }

  const wrapClass =
    layout === 'dock'
      ? 'absolute bottom-8 left-1/2 w-full max-w-2xl -translate-x-1/2 px-4'
      : 'relative mx-auto w-full max-w-2xl shrink-0 px-4'

  return (
    <div className={wrapClass}>
      {modeBanner ? (
        <p className="mb-3 rounded-lg border border-aw-border bg-aw-ai-bg px-3 py-2 text-center text-[12px] font-semibold text-aw-text-main">
          {modeBanner}
        </p>
      ) : null}

      {isHome && (
        <div className="mb-4 flex translate-x-2 items-center gap-2 text-sm font-medium text-aw-text-sub">
          <span>主页</span>
          <ChevronDown className="h-3.5 w-3.5" />
          <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-100 p-0.5">
            <Monitor className="h-3 w-3" />
          </div>
        </div>
      )}

      <div
        className="rounded-xl border border-aw-border bg-aw-page shadow-[0_8px_40px_rgba(0,0,0,0.08)] transition-all"
        onDragOver={handleDragOver}
        onDrop={(ev) => void handleDrop(ev)}
      >
        {/* 仅裁切输入区圆角；工具栏不设 overflow-hidden，避免「向上展开」的模式菜单被截断 */}
        <div className="overflow-hidden rounded-t-xl">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(ev) => void handlePaste(ev)}
            placeholder="规划、构建，输入 / 命令，@ 提及上下文；可粘贴或拖入文本 / 图片 / 音视频等"
            rows={1}
            disabled={disabled}
            title="支持复制粘贴；可从系统拖入或 Ctrl+V 粘贴文件（txt、md、json、图片、音视频等）"
            className="max-h-[200px] min-h-[56px] w-full resize-none border-none bg-transparent px-4 py-4 text-[14px] font-medium text-aw-text-main outline-none placeholder:text-aw-text-sub/50 focus:ring-0"
          />
        </div>

        <div className="flex items-center justify-between overflow-visible rounded-b-xl px-3 pb-3">
          <div className="relative flex translate-y-0.5 items-center gap-1.5" ref={modeRootRef}>
            <button
              type="button"
              className="flex items-center gap-1 rounded border border-transparent p-1 px-1.5 text-aw-text-sub transition-all hover:border-aw-border hover:bg-aw-hover"
              title="后续扩展"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={modeButtonTitle}
              className="flex min-w-0 max-w-[min(200px,46vw)] items-center gap-0.5 rounded border border-transparent p-1 px-1.5 text-[11px] font-bold text-aw-text-sub transition-all hover:border-aw-border hover:bg-aw-hover"
              onClick={() => setModeOpen((v) => !v)}
            >
              {parseMode === 'rules' ? (
                <>
                  <span className="shrink-0">自动</span>
                  <span className="shrink-0 text-aw-text-sub/50">·</span>
                  <span className="min-w-0 truncate font-mono text-[10px] font-semibold tracking-tight text-aw-text-main">
                    {modelDisplay}
                  </span>
                </>
              ) : (
                <span className="min-w-0 truncate font-mono text-[10px] font-semibold tracking-tight text-aw-text-main">
                  {modelDisplay}
                </span>
              )}
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
            {modeOpen ? (
              <ul
                className="absolute bottom-full left-0 z-[80] mb-1 min-w-[min(320px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-xl border border-aw-border bg-white py-1 shadow-lg"
                role="listbox"
              >
                {AGENT_PARSE_MODE_OPTIONS.map((o) => (
                  <li key={o.value} role="presentation">
                    <button
                      type="button"
                      role="option"
                      title={modeMenuRowTitle(o.value)}
                      className={`flex w-full px-3 py-2 text-left text-[12px] leading-snug hover:bg-aw-hover ${
                        parseMode === o.value ? 'bg-aw-hover font-bold' : ''
                      }`}
                      onClick={(ev: MouseEvent) => {
                        ev.preventDefault()
                        onParseModeChange(o.value)
                        setModeOpen(false)
                      }}
                    >
                      <span
                        className={`block w-full whitespace-normal break-words ${o.value === 'llm' ? 'font-mono text-[11px]' : ''}`}
                      >
                        {modeMenuRowLabel(o.value)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <div className="mr-2 font-mono text-[10px] tracking-tighter text-aw-text-sub/40">
              {value.length > 0 ? 'SHIFT+ENTER 换行' : ''}
            </div>
            <button
              type="button"
              disabled={disabled || !value.trim()}
              className="rounded-full bg-aw-accent p-1.5 text-white shadow-sm transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
              title="发送"
              aria-label="发送"
              onClick={() => {
                if (!disabled && value.trim()) onSend()
              }}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {isHome && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-aw-border bg-white px-3 py-1.5 text-[12px] font-bold text-aw-text-sub shadow-sm transition-colors hover:bg-aw-hover"
          >
            <span>构思新想法</span>
            <div className="flex items-center gap-0.5 opacity-40">
              <Keyboard className="h-3 w-3" />
              <span>Tab</span>
            </div>
          </button>
        </div>
      )}

      <div className="mt-4 text-center text-[10px] font-medium lowercase tracking-tight text-aw-text-sub/40">
        与画布通过指令桥通信 · 侧栏项目/节点可拖入 · 支持粘贴/拖入本地文件 · esc 关闭
      </div>
    </div>
  )
}
