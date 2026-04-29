import { fetchOpenAICompat } from './openaiProxy'

/** 百炼「声音复刻」创建音色（与文档一致，北京地域） */
export const QWEN_VOICE_CLONE_CUSTOMIZATION_CN =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization'

/** 与复刻 target_model 一致时，后续合成应使用的默认 VC 快照模型 */
export const QWEN_VC_DEFAULT_TARGET_MODEL = 'qwen3-tts-vc-2026-01-22'

const MAX_AUDIO_PAYLOAD_BYTES = 9 * 1024 * 1024

export function isQwenVcSynthesisModel(model: string): boolean {
  return /^qwen3-tts-vc/i.test(String(model || '').trim())
}

/**
 * preferred_name：仅数字、字母、下划线，≤16（文档要求）。
 */
export function sanitizeQwenVoicePreferredName(raw: string): string {
  const stem = String(raw || '')
    .trim()
    .replace(/\.[^.]+$/i, '')
  let s = stem.replace(/[^0-9a-zA-Z_]/g, '_').replace(/_+/g, '_')
  s = s.slice(0, 16).replace(/^_+/, '')
  if (!s) s = `v${Date.now().toString(36).slice(-8)}`
  return s.toLowerCase()
}

function estimateDataUrlPayloadBytes(dataUrl: string): number {
  const i = dataUrl.indexOf('base64,')
  if (i === -1) return 0
  const b64 = dataUrl.slice(i + 7).replace(/\s/g, '')
  return Math.floor((b64.length * 3) / 4)
}

export type QwenVoiceEnrollmentApiResponse = {
  output?: { voice?: string; target_model?: string }
  code?: string
  message?: string
}

/**
 * 上传参考音频（Data URL）→ 百炼 create 音色 → 返回可在 multimodal TTS 中使用的 `voice`。
 */
export async function enrollQwenVoiceCloneWithBailian(opts: {
  apiKey: string
  /** 须为 qwen3-tts-vc*，与后续合成 model 一致 */
  targetModel: string
  preferredName: string
  audioDataUrl: string
}): Promise<{ voice: string; targetModel: string }> {
  const apiKey = String(opts.apiKey || '').trim()
  if (!apiKey) throw new Error('缺少 API Key')
  const targetModel = String(opts.targetModel || '').trim() || QWEN_VC_DEFAULT_TARGET_MODEL
  if (!isQwenVcSynthesisModel(targetModel)) {
    throw new Error('声音复刻的 target_model 须为 qwen3-tts-vc 系列（如 qwen3-tts-vc-2026-01-22）')
  }
  const audioDataUrl = String(opts.audioDataUrl || '').trim()
  if (!audioDataUrl.startsWith('data:')) {
    throw new Error('参考音频须为已上传的 Data URL')
  }
  const bytes = estimateDataUrlPayloadBytes(audioDataUrl)
  if (bytes <= 0) throw new Error('无法解析参考音频数据')
  if (bytes > MAX_AUDIO_PAYLOAD_BYTES) {
    throw new Error(`参考音频过大（约 ${Math.round(bytes / 1024 / 1024)}MB），请压缩至 10MB 以内再试`)
  }
  const preferredName = sanitizeQwenVoicePreferredName(opts.preferredName)

  const res = await fetchOpenAICompat(QWEN_VOICE_CLONE_CUSTOMIZATION_CN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    json: {
      model: 'qwen-voice-enrollment',
      input: {
        action: 'create',
        target_model: targetModel,
        preferred_name: preferredName,
        audio: { data: audioDataUrl },
      },
    },
  })

  const text = await res.text()
  let data: QwenVoiceEnrollmentApiResponse = {}
  try {
    data = JSON.parse(text) as QwenVoiceEnrollmentApiResponse
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = String(data.message || text || res.statusText).trim().slice(0, 500)
    throw new Error(`复刻请求失败 HTTP ${res.status}${msg ? `：${msg}` : ''}`)
  }
  if (data.code) {
    throw new Error(`${data.code}: ${data.message || ''}`)
  }
  const voice = String(data.output?.voice || '').trim()
  const outTarget = String(data.output?.target_model || targetModel).trim()
  if (!voice) {
    throw new Error('复刻成功但未返回 output.voice，请查看控制台网络响应')
  }
  return { voice, targetModel: outTarget || targetModel }
}
