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

