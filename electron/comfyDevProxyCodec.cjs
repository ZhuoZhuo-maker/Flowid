/**
 * Comfy 开发/桌面同源代理路径段编解码（Node 版，供 electron 内置 HTTP 服务使用）。
 */
function encodeComfyDevProxyBaseSegment(baseUrlNormalized) {
  const b64 = Buffer.from(String(baseUrlNormalized || ''), 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeComfyDevProxyBaseSegment(segment) {
  const pad = '='.repeat((4 - ((segment.length % 4) || 4)) % 4)
  const b64 = String(segment || '').replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64').toString('utf8')
}

module.exports = { encodeComfyDevProxyBaseSegment, decodeComfyDevProxyBaseSegment }
