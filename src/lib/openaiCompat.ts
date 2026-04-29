export function normalizeOpenAICompatibleBaseUrl(raw: string): string {
  /**
   * Accept user inputs like:
   * - https://host/compatible-mode
   * - https://host/compatible-mode/v1
   * - https://host/compatible-mode/v1/models
   * - https://host/compatible-mode/v1/chat/completions
   * And normalize to the base URL WITHOUT the trailing /v1 so callers can safely append /v1/...
   */
  let url = String(raw || '').trim()
  url = url.replace(/\/+$/, '')
  url = url.replace(/\/v1\/chat\/completions$/i, '')
  url = url.replace(/\/chat\/completions$/i, '')
  url = url.replace(/\/v1\/models$/i, '')
  url = url.replace(/\/models$/i, '')
  url = url.replace(/\/v1$/i, '')
  return url.replace(/\/+$/, '')
}

/**
 * DashScope「OpenAI 兼容模式」基址通常只提供聊天等接口，不提供 OpenAI 标准的 `/v1/audio/speech`。
 * 用户把聊天用的 compatible-mode 填进 TTS 时，会得到上游 HTTP 404。
 */
export function dashScopeCompatibleModeTts404Hint(baseUrl: string): string | null {
  const s = String(baseUrl || '').trim().toLowerCase()
  if (!s.includes('dashscope.aliyuncs.com')) return null
  if (!s.includes('compatible-mode')) return null
  return '该地址为 DashScope 兼容模式，一般无 TTS（/v1/audio/speech）接口；聊天成功不代表 TTS 可用。请换支持 OpenAI Speech 的服务端点、本地 Gradio，或使用阿里云百炼语音合成等专用 API。'
}

