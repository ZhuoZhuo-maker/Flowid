const AUTO_RENAME_PREFIX = 'flowid.drama.autoRenamed.v1.'

/** 视为尚未自定义的项目默认名（可自动重命名） */
const DEFAULT_NAME_RE =
  /^(未命名项目(\s*\d+)?|新项目(\s*\d+)?|剧情故事短片|AI\s*短剧制片)$/

/**
 * 是否仍为默认项目名（用户未手动改过）。
 * @param name 当前项目标签名
 */
export function isDefaultDramaProjectName(name: string): boolean {
  const t = name.trim()
  if (!t) return true
  if (DEFAULT_NAME_RE.test(t)) return true
  if (/^未命名项目\s*\d+$/.test(t)) return true
  return false
}

/**
 * 从用户首条题材输入提取短剧/项目名称。
 * @param text 用户原文
 */
export function extractDramaTitleFromUserTheme(text: string): string | null {
  const raw = text.trim()
  if (!raw || /【用户选择】/.test(raw)) return null

  const book = raw.match(/《([^》]{2,32})》/)
  if (book?.[1]) return book[1].trim()

  const bold = raw.match(/\*\*([^*]{2,28})\*\*/)
  if (bold?.[1]) return bold[1].trim()

  const drama = raw.match(/([^\s：:，,。！!？?]{2,24}短剧)/)
  if (drama?.[1]) return drama[1].trim()

  const head = raw
    .replace(/^我想做(?:一条|一个)?/, '')
    .replace(/^帮我(?:做|写)?/, '')
    .split(/[：:]/)[0]
    ?.trim()
  if (head && head.length >= 4 && head.length <= 28) return head

  return null
}

/**
 * 该项目是否已执行过自动重命名。
 * @param projectTabId 项目 id
 */
export function dramaProjectAutoRenamed(projectTabId: string): boolean {
  if (!projectTabId) return false
  try {
    return localStorage.getItem(AUTO_RENAME_PREFIX + projectTabId) === '1'
  } catch {
    return false
  }
}

/**
 * 标记该项目已完成自动重命名。
 * @param projectTabId 项目 id
 */
export function markDramaProjectAutoRenamed(projectTabId: string): void {
  if (!projectTabId) return
  try {
    localStorage.setItem(AUTO_RENAME_PREFIX + projectTabId, '1')
  } catch {
    /* ignore */
  }
}

/**
 * 根据首条题材尝试自动重命名一次；用户之后手动改名不再覆盖。
 * @param projectTabId 项目 id
 * @param themeText 用户题材
 * @param currentName 当前项目名
 * @param applyRename 写入新名称
 * @returns 是否已重命名
 */
export function tryAutoRenameDramaProjectOnce(
  projectTabId: string,
  themeText: string,
  currentName: string,
  applyRename: (nextName: string) => void,
): boolean {
  if (!projectTabId || dramaProjectAutoRenamed(projectTabId)) return false
  if (!isDefaultDramaProjectName(currentName)) {
    markDramaProjectAutoRenamed(projectTabId)
    return false
  }
  const title = extractDramaTitleFromUserTheme(themeText)
  if (!title) return false
  applyRename(title)
  markDramaProjectAutoRenamed(projectTabId)
  return true
}
