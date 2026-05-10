/**
 * 输出目录镜像文件名 stem（与 localAssetDiskMirror / localImageAssetStore 共用），
 * 避免 cyclic import。
 *
 * 规则须与 {@link sanitizeFileStem}（localAssetDiskMirror）一致。
 */
export function sanitizeFileStemForOutput(raw: string): string {
  const base = String(raw || '').trim() || 'flowid'
  return (
    base
      // eslint-disable-next-line no-control-regex -- 与工程文件名规则一致
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'flowid'
  )
}

export function compactNodeIdForMirror(nodeId: string): string {
  return String(nodeId || '').trim().replace(/-/g, '')
}

/**
 * 镜像落盘文件名前缀（不含时间戳）：`{sanitize(title||'output')}_{nodeId去连字符}`，
 * 再拼接 `-{ISO时间戳}.{ext}`。
 */
export function outputMirrorStemWithNodeId(title: string | undefined, nodeId: string): string {
  const stem = sanitizeFileStemForOutput(String(title || 'output'))
  const id = compactNodeIdForMirror(nodeId)
  if (!id) return stem
  return `${stem}_${id}`
}
