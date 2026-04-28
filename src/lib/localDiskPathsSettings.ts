/**
 * 用户自定义「本地存储路径」配置。
 *
 * 说明：
 * - 浏览器无法仅凭 `F:\...` 这类字符串直接写盘；桌面端（Electron）可对工程目录与 input/output/workflow 做真实读写。
 * - `flowidProjectJsonPath`：Flowid 工程目录（历史字段名）；桌面端写入 `flowid.current.json` 与 `项目名.json`；网页端为目录句柄绑定。
 * - `inputPath` / `outputPath` / `workflowPath`：桌面端分别用于镜像上传图、生成物、工作流 JSON；网页端多为展示用绑定路径。
 */

const STORAGE_KEY = 'flowid.local.paths.v1'

/**
 * 四类常用目录/文件路径（由用户在设置中填写或通过「浏览」选择）。
 */
export type LocalDiskPathsSettings = {
  /** 输入素材目录：桌面端保存时会把本地上传的参考图镜像一份到此目录（建议与 ComfyUI input 对齐） */
  inputPath: string
  /** 输出目录：桌面端在生成完成后尝试把结果媒体落盘到此目录（建议与 ComfyUI output 对齐） */
  outputPath: string
  /** 工作流 JSON 目录：桌面端在用户保存工作流时写入 `{名称}.json`（仅文件名安全处理；建议与 Comfy 工作流目录对齐） */
  workflowPath: string
  /** Flowid 工程目录路径（历史字段名沿用 `flowidProjectJsonPath`） */
  flowidProjectJsonPath: string
}

/**
 * 返回默认空路径配置。
 */
export function getDefaultLocalDiskPathsSettings(): LocalDiskPathsSettings {
  return {
    inputPath: '',
    outputPath: '',
    workflowPath: '',
    flowidProjectJsonPath: '',
  }
}

/**
 * 从 localStorage 读取路径配置；失败则返回默认。
 */
export function loadLocalDiskPathsSettings(): LocalDiskPathsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultLocalDiskPathsSettings()
    const parsed = JSON.parse(raw) as Partial<LocalDiskPathsSettings>
    const d = getDefaultLocalDiskPathsSettings()
    return {
      inputPath: typeof parsed.inputPath === 'string' ? parsed.inputPath : d.inputPath,
      outputPath: typeof parsed.outputPath === 'string' ? parsed.outputPath : d.outputPath,
      workflowPath: typeof parsed.workflowPath === 'string' ? parsed.workflowPath : d.workflowPath,
      flowidProjectJsonPath:
        typeof parsed.flowidProjectJsonPath === 'string' ? parsed.flowidProjectJsonPath : d.flowidProjectJsonPath,
    }
  } catch {
    return getDefaultLocalDiskPathsSettings()
  }
}

/**
 * 合并写入路径配置到 localStorage。
 */
export function saveLocalDiskPathsSettings(patch: Partial<LocalDiskPathsSettings>): LocalDiskPathsSettings {
  const prev = loadLocalDiskPathsSettings()
  const next: LocalDiskPathsSettings = { ...prev, ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('flowid:local-disk-paths-changed', { detail: next }))
    }
  } catch {
    // ignore
  }
  return next
}
