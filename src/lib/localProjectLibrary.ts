import type { ProjectSnapshot } from '../types'

const CATALOG_KEY = 'flowid.localProjectCatalog.v1'
const DATA_PREFIX = 'flowid.localProject.v1:'
const BACKUP_CATALOG_KEY = 'flowid.localProjectBackupCatalog.v1'
const BACKUP_DATA_PREFIX = 'flowid.localProjectBackup.v1:'

/**
 * 与浏览器默认槽 `flowid.project.v1` 对应的第一标签「主工作台」库 id（启动时自动登记，列表里始终可见）。
 */
export const DEFAULT_WORKSPACE_LIBRARY_ID = 'flowid-browser-workspace'

/**
 * 本地项目库中的一条记录（仅元数据，画布数据另存）。
 */
export type LibraryProjectMeta = {
  id: string
  name: string
  updatedAt: number
}

/**
 * 本地项目历史备份元数据。
 */
export type LibraryProjectBackupMeta = {
  id: string
  projectId: string
  projectName: string
  createdAt: number
  nodeCount: number
  edgeCount: number
  signature: string
}

function safeParseCatalog(raw: string | null): LibraryProjectMeta[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const rec = item as Record<string, unknown>
        const id = typeof rec.id === 'string' ? rec.id : ''
        const name = typeof rec.name === 'string' ? rec.name : ''
        const updatedAt = typeof rec.updatedAt === 'number' ? rec.updatedAt : 0
        if (!id) return null
        return { id, name: name || '未命名', updatedAt }
      })
      .filter(Boolean) as LibraryProjectMeta[]
  } catch {
    return []
  }
}

function safeParseBackupCatalog(raw: string | null): LibraryProjectBackupMeta[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const rec = item as Record<string, unknown>
        const id = typeof rec.id === 'string' ? rec.id : ''
        const projectId = typeof rec.projectId === 'string' ? rec.projectId : ''
        const projectName = typeof rec.projectName === 'string' ? rec.projectName : '未命名项目'
        const createdAt = typeof rec.createdAt === 'number' ? rec.createdAt : 0
        const nodeCount = typeof rec.nodeCount === 'number' ? rec.nodeCount : 0
        const edgeCount = typeof rec.edgeCount === 'number' ? rec.edgeCount : 0
        const signature = typeof rec.signature === 'string' ? rec.signature : ''
        if (!id || !projectId) return null
        return { id, projectId, projectName, createdAt, nodeCount, edgeCount, signature }
      })
      .filter(Boolean) as LibraryProjectBackupMeta[]
  } catch {
    return []
  }
}

/**
 * 列出本地项目库（按更新时间倒序）。
 */
export function listLibraryProjects(): LibraryProjectMeta[] {
  return safeParseCatalog(localStorage.getItem(CATALOG_KEY)).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )
}

/**
 * 读取库内指定 id 的完整工程快照。
 */
export function readLibraryProject(id: string): ProjectSnapshot | null {
  try {
    const raw = localStorage.getItem(`${DATA_PREFIX}${id}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectSnapshot
    if (parsed?.version !== 1 || !Array.isArray(parsed.nodes)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 写入或更新库内工程（同时更新目录）。
 */
export function writeLibraryProject(snapshot: ProjectSnapshot, libraryId: string): void {
  const now = Date.now()
  const payload: ProjectSnapshot = {
    ...snapshot,
    name: snapshot.name || '未命名项目',
  }

  localStorage.setItem(`${DATA_PREFIX}${libraryId}`, JSON.stringify(payload))
  const catalog = safeParseCatalog(localStorage.getItem(CATALOG_KEY)).filter((m) => m.id !== libraryId)
  catalog.push({
    id: libraryId,
    name: payload.name,
    updatedAt: now,
  })
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog))
}

/**
 * 从目录删除一条记录及其数据。
 */
export function deleteLibraryProject(id: string): void {
  localStorage.removeItem(`${DATA_PREFIX}${id}`)
  const catalog = safeParseCatalog(localStorage.getItem(CATALOG_KEY)).filter((m) => m.id !== id)
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog))
  const backupCatalog = safeParseBackupCatalog(localStorage.getItem(BACKUP_CATALOG_KEY))
  const removed = backupCatalog.filter((b) => b.projectId === id)
  for (const row of removed) {
    localStorage.removeItem(`${BACKUP_DATA_PREFIX}${row.id}`)
  }
  const kept = backupCatalog.filter((b) => b.projectId !== id)
  localStorage.setItem(BACKUP_CATALOG_KEY, JSON.stringify(kept))
}

/**
 * 生成新的库内工程 id。
 */
export function createNewLibraryProjectId(): string {
  return crypto.randomUUID()
}

/**
 * 列出指定项目（或全部项目）的历史备份，按时间倒序。
 */
export function listLibraryProjectBackups(projectId?: string): LibraryProjectBackupMeta[] {
  const all = safeParseBackupCatalog(localStorage.getItem(BACKUP_CATALOG_KEY)).sort(
    (a, b) => b.createdAt - a.createdAt,
  )
  if (!projectId) return all
  return all.filter((row) => row.projectId === projectId)
}

/**
 * 读取单条历史备份快照。
 */
export function readLibraryProjectBackup(backupId: string): ProjectSnapshot | null {
  try {
    const raw = localStorage.getItem(`${BACKUP_DATA_PREFIX}${backupId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectSnapshot
    if (parsed?.version !== 1 || !Array.isArray(parsed.nodes)) return null
    return parsed
  } catch {
    return null
  }
}
