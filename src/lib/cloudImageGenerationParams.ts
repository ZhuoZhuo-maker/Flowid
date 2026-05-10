import type { CloudImageAspectKey, CloudImageResolutionTier } from '../types'

/** 画布「云端模型」比例：映射到 OpenAI Image API 的 `size`（不写入用户 prompt）。 */
const GPT_IMAGE_SIZE_1K: Record<Exclude<CloudImageAspectKey, 'auto'>, string> = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '4:5': '1024x1280',
  '3:2': '1152x768',
  '2:3': '768x1152',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '21:9': '2016x864',
}

const GPT_IMAGE_SIZE_2K: Record<Exclude<CloudImageAspectKey, 'auto'>, string> = {
  '1:1': '2048x2048',
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '4:5': '1792x2240',
  '3:2': '1728x1152',
  '2:3': '1152x1728',
  '4:3': '1536x1152',
  '3:4': '1152x1536',
  '21:9': '3024x1296',
}

/** DALL·E 3 等仅支持少量固定尺寸时的近似映射。 */
const DALLE3_SIZE_BY_ASPECT: Record<CloudImageAspectKey, string> = {
  auto: '1024x1024',
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '4:5': '1024x1792',
  '3:2': '1792x1024',
  '2:3': '1024x1792',
  '4:3': '1024x1024',
  '3:4': '1024x1792',
  '21:9': '1792x1024',
}

function tierDefaults(aspect: CloudImageAspectKey, tier: CloudImageResolutionTier): 'medium' | 'high' {
  if (aspect === 'auto') return tier === '2k' ? 'high' : 'medium'
  return tier === '2k' ? 'high' : 'medium'
}

/**
 * OpenAI 兼容 `POST /v1/images/generations` 与 Responses `image_generation` 工具的输出参数。
 * 比例与清晰度档位走独立字段，**不要**拼进用户 `prompt`。
 */
export function resolveOpenAiImageGenerationOutputParams(opts: {
  model: string
  aspect?: CloudImageAspectKey
  tier?: CloudImageResolutionTier
}): { size: string; quality?: string } {
  const model = String(opts.model || '').trim()
  const aspect = opts.aspect ?? 'auto'
  const tier = opts.tier ?? '1k'

  if (/^gpt-image/i.test(model)) {
    const quality = tierDefaults(aspect, tier)
    if (aspect === 'auto') {
      return { size: 'auto', quality }
    }
    const table = tier === '2k' ? GPT_IMAGE_SIZE_2K : GPT_IMAGE_SIZE_1K
    return { size: table[aspect], quality }
  }

  if (/^dall-e-3/i.test(model)) {
    return {
      size: DALLE3_SIZE_BY_ASPECT[aspect],
      quality: tier === '2k' ? 'hd' : 'standard',
    }
  }

  return { size: DALLE3_SIZE_BY_ASPECT[aspect] }
}

/** DashScope qwen-image `parameters.size`，使用 `宽*高`（近似比例，未知档位回退 1024*1024）。 */
export function resolveDashscopeQwenImageSize(
  aspect?: CloudImageAspectKey,
  tier?: CloudImageResolutionTier,
): string {
  const a = aspect ?? 'auto'
  const t = tier ?? '1k'
  const landWide = t === '2k' ? '1664*928' : '1280*720'
  const portTall = t === '2k' ? '928*1664' : '720*1280'
  if (a === '16:9' || a === '21:9' || a === '3:2') return landWide
  if (a === '9:16' || a === '2:3' || a === '4:5') return portTall
  if (a === '4:3') return t === '2k' ? '1472*1104' : '1024*768'
  if (a === '3:4') return t === '2k' ? '1104*1472' : '768*1024'
  return '1024*1024'
}

/**
 * Comfy 工作流占位符 `__WIDTH__` / `__HEIGHT__`：与画布「云端模型」同一套像素表（GPT-Image 1K/2K），
 * 便于比例 / 清晰度下拉与 API 生图一致。
 */
export function resolveComfyWorkflowPixelsFromAspectTier(
  aspect: CloudImageAspectKey,
  tier: CloudImageResolutionTier,
): { width: number; height: number } {
  if (aspect === 'auto') {
    return { width: 1024, height: 1024 }
  }
  const table = tier === '2k' ? GPT_IMAGE_SIZE_2K : GPT_IMAGE_SIZE_1K
  const raw = table[aspect as keyof typeof table]
  if (typeof raw !== 'string' || !raw.includes('x')) {
    return { width: 1024, height: 1024 }
  }
  const [ws, hs] = raw.split('x')
  const width = parseInt(ws, 10)
  const height = parseInt(hs, 10)
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: 1024, height: 1024 }
  }
  return { width, height }
}
