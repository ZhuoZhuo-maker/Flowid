/** 随包预设媒体路径前缀（与 `scripts/lib/preset-template-media-bundle.mjs` 一致） */
export const BUNDLED_PRESET_ASSET_PREFIX = 'flowid-bundled/presets/assets'

/**
 * 生成预设模板节点内引用的相对资源路径。
 * @param templateId 预设模板 id
 * @param key 资产键（通常为 srcAssetId 或哈希）
 * @param ext 扩展名（含点）
 */
export function bundledPresetAssetRelPath(templateId: string, key: string, ext: string): string {
  const tid = String(templateId || '').trim() || 'unknown'
  const k =
    String(key || '')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80) || 'asset'
  const e = ext.startsWith('.') ? ext : `.${ext}`
  return `${BUNDLED_PRESET_ASSET_PREFIX}/${tid}/${k}${e}`
}

/**
 * 是否已是随包预设媒体路径。
 */
export function isBundledPresetAssetPath(url: string): boolean {
  const u = String(url || '').trim().replace(/^\.?\/+/, '')
  return u.startsWith(`${BUNDLED_PRESET_ASSET_PREFIX}/`)
}
