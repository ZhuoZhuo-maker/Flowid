const STUDIO_PROMPT_TEXTAREA_SELECTOR = '[data-studio-prompt-textarea="1"]'

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
 * alert 关闭后恢复焦点：先同步抢一次（不等微任务），再少量异步重试应对 React Flow 抢焦点。
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

/** 敏感词拦截后由业务侧显式请求把焦点还回底部提示框（例如仅更新了节点数据但未走 alert）。 */
export function focusStudioPromptTextareaAfterSensitiveAlert(): void {
  scheduleRestoreFocusAfterNativeAlert(null)
}

/** 敏感词拦截时统一样式的浏览器弹窗，确保用户能明确看到原因。 */
export function alertSensitiveWordBlocked(reason?: string | null): void {
  const detail = (reason && String(reason).trim()) || '当前内容包含敏感词，请修改后重试。'
  /** 弹窗前记录焦点，便于关闭后回到原输入控件（提示框 textarea / 节点标题等）。 */
  const preferred = document.activeElement
  window.alert(`敏感词提示\n\n${detail}`)
  scheduleRestoreFocusAfterNativeAlert(preferred)
}
