/** Windows / 通用非法文件名字符 */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g

/**
 * 将系统提示词标题转为可安全落盘的文件名主体（不含扩展名）。
 */
export function sanitizePromptTitleForFilename(title: string): string {
  const t = String(title || '').trim() || 'untitled'
  return t.replace(INVALID_FILENAME_CHARS, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * 在渲染进程拼接本地绝对路径（Windows 用 `\`，否则用 `/`）。
 */
export function joinDiskPath(root: string, leaf: string): string {
  const r = String(root || '').trim().replace(/[/\\]+$/, '')
  const f = String(leaf || '').replace(/^[/\\]+/, '')
  if (!r) return f
  const sep = /^[a-zA-Z]:/.test(r) || r.includes('\\') ? '\\' : '/'
  return `${r}${sep}${f}`
}

/** 尝试加载封面时按常见扩展名顺序探测（与保存时扩展名一致） */
export const SYSTEM_PROMPT_COVER_EXT_TRIES = ['png', 'jpg', 'webp', 'gif'] as const

export function coverLeafForTry(baseTitle: string, ext: string): string {
  const base = sanitizePromptTitleForFilename(baseTitle)
  const e = ext.toLowerCase()
  if (e === 'jpeg') return `${base}.jpg`
  return `${base}.${e}`
}

export function inferImageExtensionFromFileName(fileName: string): string {
  const m = String(fileName || '').match(/(\.[a-z0-9]{2,5})$/i)
  if (!m) return '.png'
  const e = m[1].toLowerCase()
  if (e === '.jpeg') return '.jpg'
  return e
}
