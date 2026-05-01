import { imageMimeTypeFromPath } from './materialLibrary'
import { loadLocalDiskPathsSettings } from './localDiskPathsSettings'
import {
  SYSTEM_PROMPT_COVER_EXT_TRIES,
  coverLeafForTry,
  inferImageExtensionFromFileName,
  joinDiskPath,
  sanitizePromptTitleForFilename,
} from './systemPromptCoverPaths'

/** 封面文件写入或路径变更后，首页/侧栏等可监听以刷新 Blob 预览 */
export const FLOWID_COVER_DISK_CHANGED_EVENT = 'flowid:preset-cover-changed'

export function notifyCoverFilesChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(FLOWID_COVER_DISK_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

/** 删除「封面存储」下同一标题对应的所有常见扩展名文件（便于替换为另一种格式）。 */
export async function deleteAllCoverVariantsForTitle(root: string, rawTitle: string): Promise<void> {
  const desk = window.flowidDesktop
  if (!desk?.deleteFile) return
  const r = String(root || '').trim()
  if (!r) return
  for (const ext of SYSTEM_PROMPT_COVER_EXT_TRIES) {
    const leaf = coverLeafForTry(rawTitle, ext)
    const fp = joinDiskPath(r, leaf)
    await desk.deleteFile(fp)
  }
}

/** 从「封面存储」按标题读取第一张匹配的封面，返回 Blob URL（调用方需在适当时 revoke）。 */
export async function loadCoverBlobUrlFromTitle(root: string, rawTitle: string): Promise<string | null> {
  const readBinaryFile = window.flowidDesktop?.readBinaryFile
  if (!readBinaryFile || !String(root || '').trim()) return null
  const r = root.trim()
  for (const ext of SYSTEM_PROMPT_COVER_EXT_TRIES) {
    const leaf = coverLeafForTry(rawTitle, ext)
    const fp = joinDiskPath(r, leaf)
    const res = await readBinaryFile(fp)
    if (res.ok && res.data && res.data.byteLength > 0) {
      return URL.createObjectURL(new Blob([res.data], { type: imageMimeTypeFromPath(fp) }))
    }
  }
  return null
}

/**
 * 保存封面：先删同标题下各扩展名旧文件，再写入新文件（覆盖）。
 * 与首页预设、画布预设、系统提示词、项目档案共用「封面存储」目录与命名规则。
 */
export async function saveCoverReplaceByTitle(rawTitle: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!String(file.type || '').startsWith('image/')) {
    return { ok: false, error: '请选择图片文件' }
  }
  const root = String(loadLocalDiskPathsSettings().systemPromptCoverPath || '').trim()
  if (!root) {
    return { ok: false, error: '请先在「设置 → 本地存储」中填写并保存「封面存储」目录。' }
  }
  const desk = window.flowidDesktop
  if (!desk?.writeBinaryFile || !desk.ensureDirectory || !desk.deleteFile) {
    return { ok: false, error: '当前环境无法写入封面（请使用桌面版 Flowid）。' }
  }
  const ensured = await desk.ensureDirectory(root)
  if (!ensured.ok) {
    return { ok: false, error: ensured.error || '无法创建封面目录' }
  }
  const baseRoot = String(ensured.path || root).trim()
  await deleteAllCoverVariantsForTitle(baseRoot, rawTitle)

  const ext = inferImageExtensionFromFileName(file.name)
  const leaf = `${sanitizePromptTitleForFilename(rawTitle)}${ext}`
  const dest = joinDiskPath(baseRoot, leaf)
  const buf = await file.arrayBuffer()
  const w = await desk.writeBinaryFile(dest, buf)
  if (!w.ok) {
    return { ok: false, error: w.error || '保存封面失败' }
  }
  notifyCoverFilesChanged()
  return { ok: true }
}
