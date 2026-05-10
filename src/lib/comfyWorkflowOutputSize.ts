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

export function resolveComfyWorkflowWidthHeight(kind: 'image' | 'video', data: ComfyWhPick): {
  width: number
  height: number
} {
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
  /** Comfy 工作流仅按比例映射固定像素表（与云端 API 的 1K/2K 档位无关）。 */
  const raw = resolveComfyWorkflowPixelsFromAspectTier(aspect, '1k')
  return {
    width: alignComfySpatialDimension(raw.width),
    height: alignComfySpatialDimension(raw.height),
  }
}

/** 工作流 JSON 是否包含 Flowid 会替换的宽高占位符（需同时存在） */
export function workflowJsonSupportsComfySizePlaceholders(workflowJsonText: string): boolean {
  const s = String(workflowJsonText || '')
  return s.includes('__WIDTH__') && s.includes('__HEIGHT__')
}

export function workflowJsonSupportsComfyStyleTonePlaceholder(workflowJsonText: string): boolean {
  return String(workflowJsonText || '').includes('__STYLE_TONE__')
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
