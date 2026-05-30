/**
 * Electron 打包态内置 HTTP 服务：Comfy 同源反代（对齐 Vite /__comfy_local__ 与 /__comfy_dev_proxy__）。
 */
const http = require('node:http')
const https = require('node:https')
const { decodeComfyDevProxyBaseSegment } = require('./comfyDevProxyCodec.cjs')

const LOCAL_COMFY_TARGET = 'http://127.0.0.1:8188'

/**
 * @param {import('node:http').IncomingHttpHeaders} incoming
 */
function sanitizeProxyHeaders(incoming) {
  const out = { ...incoming }
  delete out.connection
  delete out.upgrade
  delete out['proxy-connection']
  delete out.host
  return out
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} targetOrigin 如 http://127.0.0.1:8188
 * @param {string} upstreamPath 含 query
 */
function pipeToUpstream(req, res, targetOrigin, upstreamPath) {
  let targetUrl
  try {
    targetUrl = new URL(upstreamPath || '/', `${targetOrigin.replace(/\/+$/, '')}/`)
  } catch (e) {
    res.statusCode = 400
    res.end(`bad upstream url: ${String(e?.message || e)}`)
    return
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    res.statusCode = 400
    res.end('upstream must be http(s)')
    return
  }
  const isHttps = targetUrl.protocol === 'https:'
  const lib = isHttps ? https : http
  const port = targetUrl.port || (isHttps ? '443' : '80')
  const headers = sanitizeProxyHeaders(req.headers)
  headers.host = targetUrl.host
  headers.origin = targetUrl.origin
  headers.referer = `${targetUrl.origin}/`

  const opts = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method || 'GET',
    headers,
    ...(isHttps ? { rejectUnauthorized: false } : {}),
  }

  const pReq = lib.request(opts, (pRes) => {
    const outHeaders = { ...pRes.headers }
    delete outHeaders['transfer-encoding']
    delete outHeaders.connection
    res.writeHead(pRes.statusCode || 502, outHeaders)
    pRes.pipe(res)
  })
  pReq.on('error', (err) => {
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`Comfy proxy: ${String(err?.message || err)}`)
    }
  })
  req.pipe(pReq)
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} incoming
 * @returns {boolean} 是否已处理
 */
function handleComfyLocalProxy(req, res, incoming) {
  if (!incoming.pathname.startsWith('/__comfy_local__/')) return false
  const rest = incoming.pathname.replace(/^\/__comfy_local__/, '') || '/'
  pipeToUpstream(req, res, LOCAL_COMFY_TARGET, rest + incoming.search)
  return true
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} incoming
 * @returns {boolean}
 */
function handleComfyDevProxy(req, res, incoming) {
  if (!incoming.pathname.startsWith('/__comfy_dev_proxy__/')) return false
  const m = incoming.pathname.match(/^\/__comfy_dev_proxy__\/([^/]+)(.*)$/)
  if (!m) {
    res.statusCode = 400
    res.end('invalid __comfy_dev_proxy__ path')
    return true
  }
  let baseDecoded
  try {
    baseDecoded = decodeComfyDevProxyBaseSegment(m[1])
  } catch {
    res.statusCode = 400
    res.end('invalid __comfy_dev_proxy__ segment')
    return true
  }
  const rest = m[2] && m[2].length > 0 ? m[2] : '/'
  pipeToUpstream(req, res, String(baseDecoded || '').trim().replace(/\/+$/, ''), rest + incoming.search)
  return true
}

module.exports = { handleComfyLocalProxy, handleComfyDevProxy }
