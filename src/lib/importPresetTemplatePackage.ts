import { unzipSync } from 'fflate'
import type { PresetTemplatePackageManifest } from './exportPresetTemplatePackage'
import { saveUserPresetPackage } from './userPresetTemplateStore'

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 从 `.flowid-preset.zip` 字节解析并写入本机用户预设库。
 */
export async function importPresetTemplateZipBytes(
  zipBytes: Uint8Array,
): Promise<{ catalogId: string; name: string }> {
  const entries = unzipSync(zipBytes)
  const manifestRaw = entries['manifest.json']
  const workflowRaw = entries['workflow.json']
  if (!manifestRaw?.length) throw new Error('无效的预设包：缺少 manifest.json')
  if (!workflowRaw?.length) throw new Error('无效的预设包：缺少 workflow.json')

  let manifest: PresetTemplatePackageManifest
  try {
    manifest = JSON.parse(decodeUtf8(manifestRaw)) as PresetTemplatePackageManifest
  } catch {
    throw new Error('无效的预设包：manifest.json 无法解析')
  }
  if (manifest.format !== 'flowid-preset' || manifest.version !== 1) {
    throw new Error('不支持的预设包格式，请使用 FLOWID 导出的 .flowid-preset.zip')
  }

  const workflowJson = decodeUtf8(workflowRaw)
  const assetFiles = new Map<string, Uint8Array>()
  for (const [path, bytes] of Object.entries(entries)) {
    if (path === 'manifest.json' || path === 'workflow.json') continue
    if (!bytes?.length) continue
    assetFiles.set(path.replace(/^\.?\/+/, ''), bytes)
  }

  const templateId = String(manifest.templateId || '').trim() || crypto.randomUUID()
  const nextManifest: PresetTemplatePackageManifest = { ...manifest, templateId }

  const { catalogId } = await saveUserPresetPackage({
    manifest: nextManifest,
    workflowJson,
    assetFiles,
  })

  return { catalogId, name: String(manifest.name || '未命名预设').trim() || '未命名预设' }
}

/**
 * 从用户选择的文件导入预设包。
 * @param {File} file
 */
export async function importPresetTemplateZipFile(file: File): Promise<{ catalogId: string; name: string }> {
  const name = String(file.name || '').toLowerCase()
  if (!name.endsWith('.zip') && !name.endsWith('.flowid-preset.zip')) {
    throw new Error('请选择 .flowid-preset.zip 或 .zip 预设包文件')
  }
  const buf = new Uint8Array(await file.arrayBuffer())
  if (!buf.length) throw new Error('文件为空')
  return importPresetTemplateZipBytes(buf)
}
