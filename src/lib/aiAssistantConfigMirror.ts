import type { AiAssistantConfig } from './aiAssistantAgent'
import { loadLocalDiskPathsSettings } from './localDiskPathsSettings'

const AI_CONFIG_FILE = 'flowid.ai-assistant.config.v1.json'

function hasDesktopFs(): boolean {
  return Boolean(window.flowidDesktop?.readUtf8File && window.flowidDesktop?.writeUtf8File)
}

function joinPath(baseDir: string, fileName: string): string {
  const b = String(baseDir || '').trim().replace(/[\\/]+$/, '')
  return `${b}/${fileName}`
}

/**
 * 从桌面端工程目录读取 AI 助手配置（不存在或损坏时返回 null）。
 */
export async function tryLoadAiAssistantConfigFromExternalPath(): Promise<Partial<AiAssistantConfig> | null> {
  if (!hasDesktopFs()) return null
  const desk = window.flowidDesktop
  if (!desk?.readUtf8File) return null
  const dir = loadLocalDiskPathsSettings().flowidProjectJsonPath.trim()
  if (!dir) return null
  const fp = joinPath(dir, AI_CONFIG_FILE)
  const res = await desk.readUtf8File(fp)
  if (!res.ok || typeof res.text !== 'string') return null
  try {
    const parsed = JSON.parse(res.text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Partial<AiAssistantConfig>
  } catch {
    return null
  }
}

/**
 * 将 AI 助手配置镜像写入桌面端工程目录，供桌面端后续启动恢复。
 */
export async function persistAiAssistantConfigToExternalPath(config: AiAssistantConfig): Promise<void> {
  if (!hasDesktopFs()) return
  const desk = window.flowidDesktop
  if (!desk?.writeUtf8File) return
  const dir = loadLocalDiskPathsSettings().flowidProjectJsonPath.trim()
  if (!dir) return
  const fp = joinPath(dir, AI_CONFIG_FILE)
  await desk.writeUtf8File(fp, JSON.stringify(config, null, 2))
}

