import type { ProjectSnapshot } from '../types'
import { mirrorInputAssetsFromProjectSnapshot } from './localAssetDiskMirror'
import { parseProjectFile, serializeProject } from './persistence'
import { loadLocalDiskPathsSettings } from './localDiskPathsSettings'
import { clearBrowserFolderHandle, loadBrowserFolderHandle, saveBrowserFolderHandle } from './browserFolderHandleStore'

const FLOWID_CURRENT_FILE = 'flowid.current.json'

/**
 * 将项目名转换为安全文件名片段。
 */
function toSafeFileStem(name: string): string {
  const raw = String(name || '').trim()
  const base = raw || 'flowid-project'
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- 显式剔除 Windows 非法文件名字符（含控制字符范围）
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'flowid-project'
}

/** 与 `mirrorProjectSnapshotTo*` 写入的「按项目名」JSON 文件名一致（仅文件名，不含目录）。 */
export function flowidMirrorNamedProjectJsonFile(projectDisplayName: string): string {
  return `${toSafeFileStem(projectDisplayName)}.json`
}

/** 工程目录内「当前快照」固定文件名。 */
export function flowidMirrorCurrentJsonFile(): typeof FLOWID_CURRENT_FILE {
  return FLOWID_CURRENT_FILE
}

function projectNamedFile(snapshot: ProjectSnapshot): string {
  return `${toSafeFileStem(snapshot.name)}.json`
}

function joinPath(baseDir: string, fileName: string): string {
  const b = String(baseDir || '').trim().replace(/[\\/]+$/, '')
  return `${b}/${fileName}`
}

/**
 * 是否运行在 Electron 且已注入 `flowidDesktop` 磁盘能力。
 */
function hasDesktopFs(): boolean {
  return Boolean(window.flowidDesktop?.readUtf8File && window.flowidDesktop?.writeUtf8File)
}

/**
 * 从桌面端配置的工程目录读取工程快照（优先 `flowid.current.json`）。
 */
export async function tryReadProjectSnapshotFromElectronPath(): Promise<ProjectSnapshot | null> {
  if (!hasDesktopFs()) return null
  const desk = window.flowidDesktop
  if (!desk?.readUtf8File) return null
  const dir = loadLocalDiskPathsSettings().flowidProjectJsonPath.trim()
  if (!dir) return null
  const res = await desk.readUtf8File(joinPath(dir, FLOWID_CURRENT_FILE))
  if (!res.ok || typeof res.text !== 'string') return null
  try {
    return parseProjectFile(res.text)
  } catch {
    return null
  }
}

/**
 * 将工程快照写入桌面端工程目录：
 * - `flowid.current.json`：当前工作台最新状态（启动优先读取）；
 * - `项目名.json`：便于按项目回溯历史。
 */
export async function mirrorProjectSnapshotToElectronPath(snapshot: ProjectSnapshot): Promise<void> {
  if (!hasDesktopFs()) return
  const desk = window.flowidDesktop
  if (!desk?.writeUtf8File) return
  const dir = loadLocalDiskPathsSettings().flowidProjectJsonPath.trim()
  if (!dir) return
  const text = serializeProject(snapshot)
  await desk.writeUtf8File(joinPath(dir, FLOWID_CURRENT_FILE), text)
  await desk.writeUtf8File(joinPath(dir, projectNamedFile(snapshot)), text)
}

/**
 * 从浏览器绑定的工程目录读取 `flowid.current.json`。
 */
export async function tryReadProjectSnapshotFromBrowserFolder(): Promise<ProjectSnapshot | null> {
  const dir = await loadBrowserFolderHandle('flowidProjectJsonPath')
  if (!dir) return null
  try {
    const fileHandle = await dir.getFileHandle(FLOWID_CURRENT_FILE, { create: false })
    const file = await fileHandle.getFile()
    const text = await file.text()
    return parseProjectFile(text)
  } catch {
    return null
  }
}

/**
 * 将工程写入浏览器绑定目录（`flowid.current.json` + `项目名.json`）。
 */
export async function mirrorProjectSnapshotToBrowserFolder(snapshot: ProjectSnapshot): Promise<void> {
  const dir = await loadBrowserFolderHandle('flowidProjectJsonPath')
  if (!dir) return
  const text = serializeProject(snapshot)
  const writeOne = async (fileName: string) => {
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const fh = fileHandle as FileSystemFileHandle & { createWritable?: () => Promise<FileSystemWritableFileStream> }
    if (typeof fh.createWritable !== 'function') return
    const writable = await fh.createWritable()
    try {
      await writable.write(text)
      await writable.close()
    } catch {
      try {
        await writable.close()
      } catch {
        /* 忽略关闭错误 */
      }
    }
  }
  await writeOne(FLOWID_CURRENT_FILE)
  await writeOne(projectNamedFile(snapshot))
}

/**
 * 启动时加载优先级：桌面工程目录 → 浏览器绑定目录 → null。
 */
export async function tryLoadExternalProjectSnapshot(): Promise<ProjectSnapshot | null> {
  const fromElectron = await tryReadProjectSnapshotFromElectronPath()
  if (fromElectron) return fromElectron
  return await tryReadProjectSnapshotFromBrowserFolder()
}

/**
 * 保存时同时镜像到外部存储（不抛错到 UI，失败仅控制台）。
 */
export async function persistProjectSnapshotToExternalStores(snapshot: ProjectSnapshot): Promise<void> {
  try {
    await mirrorProjectSnapshotToElectronPath(snapshot)
  } catch (e) {
    console.warn('[Flowid] 写入桌面工程路径失败', e)
  }
  try {
    await mirrorProjectSnapshotToBrowserFolder(snapshot)
  } catch (e) {
    console.warn('[Flowid] 写入浏览器工程目录失败', e)
  }
  try {
    await mirrorInputAssetsFromProjectSnapshot(snapshot, { reason: 'manual-save' })
  } catch (e) {
    console.warn('[Flowid] 画布素材镜像到 input 目录失败', e)
  }
}

/**
 * 浏览器：选择工程目录并绑定（兼容旧函数名）。
 */
export async function bindFlowidProjectJsonViaBrowserPicker(): Promise<boolean> {
  if (typeof window.showDirectoryPicker !== 'function') return false
  const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
  await saveBrowserFolderHandle('flowidProjectJsonPath', dir)
  return true
}

/**
 * 清除浏览器绑定的工程目录。
 */
export async function unbindFlowidProjectJsonBrowser(): Promise<void> {
  await clearBrowserFolderHandle('flowidProjectJsonPath')
}
