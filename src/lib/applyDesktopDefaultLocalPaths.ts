import {
  loadLocalDiskPathsSettings,
  saveLocalDiskPathsSettings,
  type LocalDiskPathsSettings,
} from './localDiskPathsSettings'

const CORE_PATH_KEYS: Array<
  keyof Pick<
    LocalDiskPathsSettings,
    | 'inputPath'
    | 'outputPath'
    | 'workflowPath'
    | 'flowidProjectJsonPath'
    | 'materialLibraryPath'
    | 'systemPromptCoverPath'
  >
> = [
  'inputPath',
  'outputPath',
  'workflowPath',
  'flowidProjectJsonPath',
  'materialLibraryPath',
  'systemPromptCoverPath',
]

/** 六项「本地存储」是否均未配置（空串视为未配置） */
export function areCoreLocalDiskPathsUnset(settings: LocalDiskPathsSettings): boolean {
  return CORE_PATH_KEYS.every((k) => !String(settings[k] || '').trim())
}

/**
 * 桌面端首次启动：在 `{安装盘}:\flowid-zy` 下创建 input / output 等子目录并写入设置。
 * 任一路径已有用户配置则跳过，避免覆盖。
 */
export async function applyDesktopDefaultFlowidZyPathsIfNeeded(): Promise<void> {
  if (typeof window === 'undefined') return
  const desk = window.flowidDesktop
  if (!desk?.getDefaultLocalStoragePaths || !desk?.ensureDirectory) return

  const cur = loadLocalDiskPathsSettings()
  if (!areCoreLocalDiskPathsUnset(cur)) return

  const res = await desk.getDefaultLocalStoragePaths()
  if (!res?.ok || !res.paths) return

  const p = res.paths
  const dirs = [
    p.inputPath,
    p.outputPath,
    p.workflowPath,
    p.flowidProjectJsonPath,
    p.materialLibraryPath,
    p.systemPromptCoverPath,
  ].filter((d) => String(d || '').trim())

  for (const dir of dirs) {
    await desk.ensureDirectory(String(dir).trim())
  }

  saveLocalDiskPathsSettings({
    inputPath: p.inputPath,
    outputPath: p.outputPath,
    workflowPath: p.workflowPath,
    flowidProjectJsonPath: p.flowidProjectJsonPath,
    materialLibraryPath: p.materialLibraryPath,
    systemPromptCoverPath: p.systemPromptCoverPath,
  })
}
