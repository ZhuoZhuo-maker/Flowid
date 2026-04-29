/** 百炼千问 TTS：HTTP 多模态生成（非 compatible-mode） */
export const QWEN_TTS_MULTIMODAL_GENERATION_CN =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

export const QWEN_TTS_MULTIMODAL_GENERATION_INTL =
  'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

const PATH_MARK = '/services/aigc/multimodal-generation/generation'

/**
 * 设置里可填完整 URL，或填快捷词 `qwen-tts-multimodal`（默认北京地域）。
 */
export function isQwenTtsMultimodalEndpoint(raw: string): boolean {
  const t = String(raw || '').trim().toLowerCase()
  if (!t) return false
  if (t === 'qwen-tts-multimodal' || t === 'bailian-qwen-tts') return true
  return t.includes(PATH_MARK)
}

/**
 * 用户把「聊天」用的 compatible-mode 基址误填进 TTS 时，/v1/audio/speech 必 404（不是百炼故障）。
 */
export function isDashScopeCompatibleModeMisusedForTts(raw: string): boolean {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return false
  if (isQwenTtsMultimodalEndpoint(raw)) return false
  return s.includes('dashscope') && s.includes('compatible-mode')
}

export function normalizeQwenTtsMultimodalUrl(raw: string): string {
  const t = String(raw || '').trim()
  if (!t) return QWEN_TTS_MULTIMODAL_GENERATION_CN
  const lower = t.toLowerCase()
  if (lower === 'qwen-tts-multimodal' || lower === 'bailian-qwen-tts') {
    return QWEN_TTS_MULTIMODAL_GENERATION_CN
  }
  return t.replace(/\/+$/, '')
}

export type QwenTtsMultimodalResponse = {
  status_code?: number
  code?: string
  message?: string
  output?: {
    audio?: {
      url?: string
      data?: string
    }
  }
}
