import { resolveComfyWorkflowPixelsFromAspectTier } from './cloudImageGenerationParams'
import type { CloudImageAspectKey, ImageNodeData, VideoNodeData } from '../types'

/** 与常见 VAE/Latent 对齐，避免奇数尺寸 */
export const FLOWID_COMFY_SIZE_ALIGN = 8
export const FLOWID_COMFY_SPATIAL_MIN = 256
export const FLOWID_COMFY_SPATIAL_MAX = 4096

export function alignComfySpatialDimension(n: number): number {
  const x = Math.round(Number(n) || 0)
  if (!Number.isFinite(x)) return FLOWID_COMFY_SPATIAL_MIN
  const clamped = Math.min(FLOWID_COMFY_SPATIAL_MAX, Math.max(FLOWID_COMFY_SPATIAL_MIN, x))
  const aligned = Math.round(clamped / FLOWID_COMFY_SIZE_ALIGN) * FLOWID_COMFY_SIZE_ALIGN
  return Math.min(FLOWID_COMFY_SPATIAL_MAX, Math.max(FLOWID_COMFY_SPATIAL_MIN, aligned))
}

type ComfyWhPick = Pick<
  ImageNodeData | VideoNodeData,
  'comfyWorkflowWidth' | 'comfyWorkflowHeight' | 'comfyWorkflowAspect' | 'comfyWorkflowUseCustomPixels'
>

/**
 * 工作流 JSON 是否使用 Qwen Image 系模型（须用官方固定分辨率，不能用 GPT 生图像素表）。
 */
export function workflowJsonUsesQwenImageModel(workflowJsonText: string): boolean {
  const s = String(workflowJsonText || '')
  return /qwen_image/i.test(s) || /qwen_image_2512/i.test(s)
}

/**
 * Wan2.2 SVI 加速稿：按约 512×896（16GB 480p 档）总像素预算映射各比例，避免 GPT 1K 表过大导致 OOM。
 */
export function workflowJsonUsesWanSvi16GbVideoScale(workflowJsonText: string): boolean {
  const s = String(workflowJsonText || '')
  return /WanImageToVideoSVIPro/i.test(s)
}

/** Wan SVI 16GB：仅横屏 / 竖屏两档（与 Comfy 强动感工作流 Scale 节点一致） */
export const WAN_SVI_LANDSCAPE_PORTRAIT_PIXELS = {
  landscape: { width: 896, height: 512 },
  portrait: { width: 512, height: 896 },
} as const

/** Wan SVI 工作流面板：仅横屏 / 竖屏 */
export const WAN_SVI_ASPECT_PANEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '16:9', label: '横屏 16:9 · 896×512' },
  { value: '9:16', label: '竖屏 9:16 · 512×896' },
]

/**
 * Wan2.2 SVI：含 `__WIDTH__`/`__HEIGHT__` 时面板只提供横屏 / 竖屏（不用完整比例表）。
 */
export function workflowJsonUsesWanSviLandscapePortraitOnly(workflowJsonText: string): boolean {
  return (
    workflowJsonUsesWanSvi16GbVideoScale(workflowJsonText) &&
    workflowJsonSupportsComfySizePlaceholders(workflowJsonText)
  )
}

/** 按当前工作流返回比例下拉选项 */
export function getComfyWorkflowAspectPanelOptions(workflowJsonText?: string): Array<{ value: string; label: string }> {
  if (workflowJsonText && workflowJsonUsesWanSviLandscapePortraitOnly(workflowJsonText)) {
    return WAN_SVI_ASPECT_PANEL_OPTIONS
  }
  return COMFY_WORKFLOW_ASPECT_PANEL_OPTIONS
}

/** @param aspect 画布比例；Wan SVI 强动感工作流仅映射横屏 896×512 / 竖屏 512×896 */
export function resolveWanSvi16GbWorkflowPixelsFromAspect(aspect: CloudImageAspectKey): {
  width: number
  height: number
} {
  const isPortrait =
    aspect === '9:16' || aspect === '2:3' || aspect === '3:4' || aspect === '4:5'
  const preset = isPortrait
    ? WAN_SVI_LANDSCAPE_PORTRAIT_PIXELS.portrait
    : WAN_SVI_LANDSCAPE_PORTRAIT_PIXELS.landscape
  return {
    width: alignComfySpatialDimension(preset.width),
    height: alignComfySpatialDimension(preset.height),
  }
}

/**
 * Qwen-Image-2512 官方支持的宽高（见 ComfyUI 文档）；无 4:5 时用竖版 3:4 近似。
 */
const QWEN_IMAGE_PIXELS_BY_ASPECT: Record<Exclude<CloudImageAspectKey, 'auto'>, { width: number; height: number }> = {
  '1:1': { width: 1328, height: 1328 },
  '16:9': { width: 1664, height: 928 },
  '9:16': { width: 928, height: 1664 },
  '4:3': { width: 1472, height: 1104 },
  '3:4': { width: 1104, height: 1472 },
  '3:2': { width: 1584, height: 1056 },
  '2:3': { width: 1056, height: 1584 },
  '4:5': { width: 1104, height: 1472 },
  '21:9': { width: 1664, height: 928 },
}

/** @param aspect 画布比例 */
export function resolveQwenImageWorkflowPixelsFromAspect(aspect: CloudImageAspectKey): {
  width: number
  height: number
} {
  if (aspect === 'auto') {
    return { width: 1328, height: 1328 }
  }
  return QWEN_IMAGE_PIXELS_BY_ASPECT[aspect] ?? { width: 1328, height: 1328 }
}

/** 自定义宽高时：按宽高比匹配最近的 Qwen 官方尺寸，避免 3072×1164 等非法组合。 */
function snapCustomPixelsToQwenPreset(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const targetRatio = w / h
  let best = resolveQwenImageWorkflowPixelsFromAspect('1:1')
  let bestDelta = Number.POSITIVE_INFINITY
  for (const preset of Object.values(QWEN_IMAGE_PIXELS_BY_ASPECT)) {
    const r = preset.width / preset.height
    const delta = Math.abs(Math.log(targetRatio) - Math.log(r))
    if (delta < bestDelta) {
      bestDelta = delta
      best = preset
    }
  }
  return best
}

export function resolveComfyWorkflowWidthHeight(
  kind: 'image' | 'video',
  data: ComfyWhPick,
  workflowJsonText?: string,
): {
  width: number
  height: number
} {
  const useQwen = workflowJsonText ? workflowJsonUsesQwenImageModel(workflowJsonText) : false

  if (useQwen) {
    if (data.comfyWorkflowUseCustomPixels === true) {
      const defW = 1328
      const defH = 1328
      const w =
        typeof data.comfyWorkflowWidth === 'number' && Number.isFinite(data.comfyWorkflowWidth)
          ? data.comfyWorkflowWidth
          : defW
      const h =
        typeof data.comfyWorkflowHeight === 'number' && Number.isFinite(data.comfyWorkflowHeight)
          ? data.comfyWorkflowHeight
          : defH
      return snapCustomPixelsToQwenPreset(w, h)
    }
    const hasLegacyDims =
      data.comfyWorkflowAspect == null &&
      typeof data.comfyWorkflowWidth === 'number' &&
      Number.isFinite(data.comfyWorkflowWidth) &&
      typeof data.comfyWorkflowHeight === 'number' &&
      Number.isFinite(data.comfyWorkflowHeight)
    if (hasLegacyDims) {
      return snapCustomPixelsToQwenPreset(data.comfyWorkflowWidth!, data.comfyWorkflowHeight!)
    }
    const aspect: CloudImageAspectKey = data.comfyWorkflowAspect ?? (kind === 'video' ? '16:9' : '1:1')
    return resolveQwenImageWorkflowPixelsFromAspect(aspect)
  }

  if (data.comfyWorkflowUseCustomPixels === true) {
    const defW = kind === 'video' ? 1280 : 1024
    const defH = kind === 'video' ? 720 : 1024
    const w =
      typeof data.comfyWorkflowWidth === 'number' && Number.isFinite(data.comfyWorkflowWidth)
        ? data.comfyWorkflowWidth
        : defW
    const h =
      typeof data.comfyWorkflowHeight === 'number' && Number.isFinite(data.comfyWorkflowHeight)
        ? data.comfyWorkflowHeight
        : defH
    return { width: alignComfySpatialDimension(w), height: alignComfySpatialDimension(h) }
  }

  const hasLegacyDims =
    data.comfyWorkflowAspect == null &&
    typeof data.comfyWorkflowWidth === 'number' &&
    Number.isFinite(data.comfyWorkflowWidth) &&
    typeof data.comfyWorkflowHeight === 'number' &&
    Number.isFinite(data.comfyWorkflowHeight)
  if (hasLegacyDims) {
    return {
      width: alignComfySpatialDimension(data.comfyWorkflowWidth!),
      height: alignComfySpatialDimension(data.comfyWorkflowHeight!),
    }
  }

  const aspect: CloudImageAspectKey = data.comfyWorkflowAspect ?? (kind === 'video' ? '16:9' : '1:1')
  const useWanSvi = workflowJsonText ? workflowJsonUsesWanSvi16GbVideoScale(workflowJsonText) : false
  if (useWanSvi) {
    return resolveWanSvi16GbWorkflowPixelsFromAspect(aspect)
  }
  /** Comfy 工作流仅按比例映射固定像素表（与云端 API 的 1K/2K 档位无关）。 */
  const raw = resolveComfyWorkflowPixelsFromAspectTier(aspect, '1k')
  return {
    width: alignComfySpatialDimension(raw.width),
    height: alignComfySpatialDimension(raw.height),
  }
}

/** 面板提示：说明当前工作流使用的像素映射表 */
export function describeComfyWorkflowSizeMapping(workflowJsonText?: string): string {
  if (workflowJsonText && workflowJsonUsesQwenImageModel(workflowJsonText)) {
    return 'Qwen Image 官方固定分辨率表'
  }
  if (workflowJsonText && workflowJsonUsesWanSvi16GbVideoScale(workflowJsonText)) {
    return 'Wan SVI 强动感：横屏 896×512 / 竖屏 512×896'
  }
  return '通用 Comfy 1K 像素表（与云端模型比例一致）'
}

/** 工作流 JSON 是否包含 Flowid 会替换的宽高占位符（需同时存在） */
export function workflowJsonSupportsComfySizePlaceholders(workflowJsonText: string): boolean {
  const s = String(workflowJsonText || '')
  return s.includes('__WIDTH__') && s.includes('__HEIGHT__')
}

export function workflowJsonSupportsComfyStyleTonePlaceholder(workflowJsonText: string): boolean {
  return String(workflowJsonText || '').includes('__STYLE_TONE__')
}

/** 工作流 JSON 是否包含宫格分割占位符 */
export function workflowJsonSupportsComfyGridPlaceholders(workflowJsonText: string): boolean {
  return String(workflowJsonText || '').includes('__GRID_IMAGE_1__')
}

/**
 * 工作流名称是否表示「参考图张数由用户自定」（如云端「(图生图)-多图编辑」）。
 */
export function workflowNameSuggestsVariableRefCount(workflowName: string): boolean {
  const name = String(workflowName || '').trim()
  if (!name) return false
  return /多图编辑|多图参考|多图融合|自定义\s*张|可变\s*张|任意\s*张/i.test(name)
}

/**
 * 工作流是否允许「用户实际上传张数 < Comfy 内 LoadImage 槽位数」。
 * - 含 `__REF_COUNT__`（forLoop 多图编辑占位符版）
 * - 或名称/结构表明为多图编辑（云端 JSON 常无占位符，但有 ImageReel + 多个 LoadImage）
 * 不足槽位时由 `injectVisualImageFallback` 用末张图填充。
 */
export function workflowJsonSupportsVariableRefCount(
  workflowJsonText: string,
  workflowName?: string,
): boolean {
  const text = String(workflowJsonText || '')
  if (text.includes('__REF_COUNT__')) return true
  if (workflowNameSuggestsVariableRefCount(workflowName || '')) return true
  /** LayerUtility ImageReel：多图编辑类工作流典型结构 */
  if (/ImageReel(?:Composit)?/i.test(text)) return true
  return false
}

/** 旧版仅存宽高、未写比例字段的工程数据 */
export function isLegacyComfyWorkflowPixelOnly(data: ComfyWhPick): boolean {
  return (
    data.comfyWorkflowAspect == null &&
    data.comfyWorkflowUseCustomPixels !== true &&
    typeof data.comfyWorkflowWidth === 'number' &&
    Number.isFinite(data.comfyWorkflowWidth) &&
    typeof data.comfyWorkflowHeight === 'number' &&
    Number.isFinite(data.comfyWorkflowHeight)
  )
}

/** 与底部面板「云端模型」比例下拉同一套文案，供 Comfy 工作流块复用 */
export const COMFY_WORKFLOW_ASPECT_PANEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto · 由模型决定尺寸' },
  { value: '1:1', label: '1:1 · 头像 / 社交头图' },
  { value: '16:9', label: '16:9 · 壁纸 / 横幅' },
  { value: '9:16', label: '9:16 · 手机壁纸 / 短视频封面' },
  { value: '4:5', label: '4:5 · 社交媒体 / 小红书' },
  { value: '3:2', label: '3:2 · 摄影 / 横版插画' },
  { value: '2:3', label: '2:3 · 海报 / 竖版插画' },
  { value: '4:3', label: '4:3 · 演示 / 课件配图' },
  { value: '3:4', label: '3:4 · 书籍封面 / 产品图' },
  { value: '21:9', label: '21:9 · 电影画幅 / 超宽屏' },
]

/**
 * 写入占位符 `__STYLE_TONE__`（建议接在 CLIP / 提示词类节点；勿含英文双引号以免破坏 JSON）。
 */
export const COMFY_WORKFLOW_STYLE_TONE_PANEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '默认 · 不追加风格短语' },
  { value: '写实摄影，自然光线，肤色自然，细节清晰', label: '写实 · 自然光' },
  { value: '日系动漫，赛璐璐上色，干净线稿，明亮配色', label: '动漫 · 赛璐璐' },
  { value: '胶片电影感，轻微颗粒，暖色影调，柔和对比', label: '胶片 · 电影感' },
  { value: '高对比戏剧光，轮廓光，深色阴影，质感强烈', label: '戏剧 · 高对比' },
  { value: '柔和明亮，低饱和，清新通透，商业产品风', label: '清新 · 商业风' },
  { value: '水墨意境，留白，写意笔触，东方美学', label: '水墨 · 写意' },
]
