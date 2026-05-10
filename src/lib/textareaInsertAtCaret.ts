/** 在 textarea 当前选区插入文本，返回新全文与插入后光标位置。 */
export function insertTextAtCaret(
  el: HTMLTextAreaElement,
  textToInsert: string,
  fallbackCaret?: number,
): { nextValue: string; nextCaret: number } {
  const v = el.value ?? ''
  const start = Number.isFinite(el.selectionStart) ? (el.selectionStart ?? v.length) : (fallbackCaret ?? v.length)
  const end = Number.isFinite(el.selectionEnd) ? (el.selectionEnd ?? start) : start
  const before = v.slice(0, start)
  const after = v.slice(end)
  const insert = String(textToInsert || '')
  const nextValue = `${before}${insert}${after}`
  const nextCaret = before.length + insert.length
  return { nextValue, nextCaret }
}

/**
 * 同步读取拖放中的 `text/plain`（不含文件）。
 * 必须在 `drop` 事件同步阶段调用：进入微任务/await 后 `getData` 常已失效（Chromium/Electron）。
 */
export function readDraggedPlainTextSync(dataTransfer: DataTransfer | null): string {
  if (!dataTransfer) return ''
  return dataTransfer.getData('text/plain') || ''
}

/** 从拖放数据中读取纯文本（含 .txt / text/* 首文件）。 */
export async function readDraggedPlainText(dataTransfer: DataTransfer | null): Promise<string> {
  if (!dataTransfer) return ''
  let text = readDraggedPlainTextSync(dataTransfer)
  if (text.trim()) return text
  const f = dataTransfer.files?.[0]
  if (!f) return ''
  const type = String(f.type || '')
  const name = String(f.name || '')
  if (type.startsWith('text/') || /\.(txt|md|csv)$/i.test(name)) {
    try {
      return await f.text()
    } catch {
      return ''
    }
  }
  return ''
}
