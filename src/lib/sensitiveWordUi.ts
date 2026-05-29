const STUDIO_PROMPT_TEXTAREA_SELECTOR = '[data-studio-prompt-textarea="1"]'

let activeSensitiveOverlay: HTMLElement | null = null

function tryFocusElement(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return false
  const inp = el as HTMLInputElement
  if (inp.disabled || inp.readOnly) return false
  try {
    inp.focus({ preventScroll: true })
  } catch {
    inp.focus()
  }
  return document.activeElement === el
}

function restorePromptOrPreferredFocus(preferred: Element | null): boolean {
  if (tryFocusElement(preferred)) return true
  const ta = document.querySelector<HTMLTextAreaElement>(STUDIO_PROMPT_TEXTAREA_SELECTOR)
  return tryFocusElement(ta)
}

/**
 * 关闭原生 alert 后恢复焦点：先同步抢一次（不等微任务），再少量异步重试应对 React Flow 抢焦点。
 */
function scheduleRestoreFocusAfterNativeAlert(preferred: Element | null): void {
  restorePromptOrPreferredFocus(preferred)
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      restorePromptOrPreferredFocus(preferred)
      requestAnimationFrame(() => restorePromptOrPreferredFocus(preferred))
    })
  })
}

function removeSensitiveOverlay(): void {
  if (!activeSensitiveOverlay) return
  activeSensitiveOverlay.remove()
  activeSensitiveOverlay = null
}

/**
 * 非阻塞敏感词提示（替代 `window.alert`）：不冻结主线程，关闭后同样尝试把焦点还回输入框。
 * 检索库加载后 AC 构建若占满主线程，用户仍能看到页面；与分帧建树配合可明显减轻「点确定后很久不能打字」。
 */
export function alertSensitiveWordBlocked(reason?: string | null): void {
  const detail = (reason && String(reason).trim()) || '当前内容包含敏感词，请修改后重试。'
  const preferred = document.activeElement

  removeSensitiveOverlay()

  const backdrop = document.createElement('div')
  backdrop.setAttribute('role', 'alertdialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.setAttribute('aria-labelledby', 'flowid-sensitive-alert-title')
  backdrop.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'box-sizing:border-box',
    'background:rgba(15,23,42,0.55)',
    'backdrop-filter:saturate(1.1) blur(2px)',
  ].join(';')

  const card = document.createElement('div')
  card.style.cssText = [
    'max-width:min(480px,calc(100vw - 32px))',
    'width:100%',
    'border-radius:12px',
    'padding:20px 22px',
    'background:#1e293b',
    'color:#e2e8f0',
    'font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'box-shadow:0 18px 48px rgba(0,0,0,0.45)',
    'border:1px solid rgba(148,163,184,0.35)',
  ].join(';')

  const title = document.createElement('div')
  title.id = 'flowid-sensitive-alert-title'
  title.textContent = '敏感词提示'
  title.style.cssText = 'font-weight:600;font-size:15px;margin-bottom:10px;color:#f8fafc;'

  const body = document.createElement('div')
  body.textContent = detail
  body.style.cssText =
    'white-space:pre-wrap;word-break:break-word;margin-bottom:18px;color:#cbd5e1;max-height:min(52vh,420px);overflow-y:auto'

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;'

  const ok = document.createElement('button')
  ok.type = 'button'
  ok.textContent = '知道了'
  ok.style.cssText = [
    'appearance:none',
    'border:1px solid rgba(234,88,12,0.65)',
    'border-radius:8px',
    'padding:8px 18px',
    'cursor:pointer',
    'font:inherit',
    'font-weight:600',
    'background:#ea580c',
    'color:#fff',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.12)',
  ].join(';')
  ok.addEventListener('mouseenter', () => {
    ok.style.background = '#f97316'
    ok.style.borderColor = 'rgba(249,115,22,0.85)'
  })
  ok.addEventListener('mouseleave', () => {
    ok.style.background = '#ea580c'
    ok.style.borderColor = 'rgba(234,88,12,0.65)'
  })

  const dismiss = () => {
    removeSensitiveOverlay()
    scheduleRestoreFocusAfterNativeAlert(preferred)
    window.removeEventListener('keydown', onKey, true)
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' || ev.key === 'Enter') {
      ev.preventDefault()
      ev.stopPropagation()
      dismiss()
    }
  }

  ok.addEventListener('click', dismiss)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss()
  })
  window.addEventListener('keydown', onKey, true)

  row.appendChild(ok)
  card.appendChild(title)
  card.appendChild(body)
  card.appendChild(row)
  backdrop.appendChild(card)
  document.body.appendChild(backdrop)
  activeSensitiveOverlay = backdrop

  requestAnimationFrame(() => {
    try {
      ok.focus()
    } catch {
      // ignore
    }
  })
}

/** 敏感词拦截后由业务侧显式请求把焦点还回底部提示框（例如仅更新了节点数据但未走 alert）。 */
export function focusStudioPromptTextareaAfterSensitiveAlert(): void {
  scheduleRestoreFocusAfterNativeAlert(null)
}
