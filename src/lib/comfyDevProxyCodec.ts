/**
 * 开发态 Vite 同源代理路径段编解码（不含业务逻辑，供 vite.config 与 comfyClient 共用）。
 * 将完整 baseUrl（无尾斜杠）编码进 `/__comfy_dev_proxy__/<segment>/...` 路径前缀。
 * 仅使用 TextEncoder / btoa，避免依赖 Node `Buffer`（浏览器与 tsc 默认 lib 均可编译）。
 */
export function encodeComfyDevProxyBaseSegment(baseUrlNormalized: string): string {
  const bytes = new TextEncoder().encode(baseUrlNormalized)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeComfyDevProxyBaseSegment(segment: string): string {
  const pad = '='.repeat((4 - ((segment.length % 4) || 4)) % 4)
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}
