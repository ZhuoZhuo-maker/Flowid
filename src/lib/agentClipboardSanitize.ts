/**
 * 助手气泡复制到剪贴板时：去掉 data URL / 超长 base64，避免粘贴进记事本占满屏。
 */

/** 单次匹配限制 payload 长度，避免巨串卡死主线程 */
const DATA_URL_RE =
  /data:[a-zA-Z0-9][\w+.-]*\/[\w+.-]*(?:;charset=[^;]+)?;base64,[A-Za-z0-9+/=\r\n ]{64,500000}/gi

/** 疑似「仅 base64」的整段选区（换行可忽略） */
function looksLikeRawBase64Block(s: string): boolean {
  const t = s.replace(/\s/g, '')
  if (t.length < 400) return false
  if (!/^[A-Za-z0-9+/]+=*$/.test(t)) return false
  return true
}

/** 将选区净化后写入剪贴板；若无需改动则返回原串 */
export function sanitizeChatCopySelection(selected: string): string {
  if (selected.length > 900_000) return '[选区过大已省略；请勿一次复制整段内嵌文件。]'
  let out = selected.replace(DATA_URL_RE, '[内嵌 base64 数据已省略]')
  if (looksLikeRawBase64Block(out)) {
    return '[已省略整段 base64 文本；请只选中需要的文字再复制。]'
  }
  return out
}

export function copyNeedsSanitize(selected: string): boolean {
  return sanitizeChatCopySelection(selected) !== selected
}
