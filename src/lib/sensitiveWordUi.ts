/** 敏感词拦截时统一样式的浏览器弹窗，确保用户能明确看到原因。 */
export function alertSensitiveWordBlocked(reason?: string | null): void {
  const detail = (reason && String(reason).trim()) || '当前内容包含敏感词，请修改后重试。'
  window.alert(`敏感词提示\n\n${detail}`)
  /**
   * `alert` 会抢走焦点；紧接着若主线程忙于构建 AC，用户会长时间点不进底部提示框。
   * 在下一帧后尝试把焦点还到画布提示词 textarea（存在时）。
   */
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        '[data-studio-prompt-textarea="1"]',
      )
      if (!el || el.disabled || el.readOnly) return
      try {
        el.focus({ preventScroll: true })
      } catch {
        el.focus()
      }
    })
  })
}
