/**
 * 开发 / preview：将 `/__comfy_dev_proxy__/<segment>/...` 转发到解码后的 Comfy baseUrl。
 * 使用 Node 原生 http(s).request + rejectUnauthorized:false，避免 http-proxy 动态 target 对仙宫云 HTTPS 常 502。
 */
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { decodeComfyDevProxyBaseSegment } from '../src/lib/comfyDevProxyCodec'

function sanitizeProxyHeaders(incoming: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...incoming }
  delete out.connection
  delete out.upgrade
  delete out['proxy-connection']
  delete out.host
  return out
}

function mountComfyDevProxy(middlewares: Connect.Server) {
  middlewares.use((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const raw = req.url || ''
    if (!raw.startsWith('/__comfy_dev_proxy__/')) {
      next()
      return
    }
    let incoming: URL
    try {
      incoming = new URL(raw, 'http://127.0.0.1')
    } catch {
      next()
      return
    }
    const m = incoming.pathname.match(/^\/__comfy_dev_proxy__\/([^/]+)(.*)$/)
    if (!m) {
      next()
      return
    }
    const segment = m[1]
    const rest = m[2] && m[2].length > 0 ? m[2] : '/'
    let baseDecoded: string
    try {
      baseDecoded = decodeComfyDevProxyBaseSegment(segment)
    } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('invalid __comfy_dev_proxy__ segment')
      return
    }
    const baseNorm = String(baseDecoded || '').trim().replace(/\/+$/, '')
    let targetUrl: URL
    try {
      targetUrl = new URL((rest || '/') + incoming.search, `${baseNorm}/`)
    } catch (e) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`bad upstream url: ${String((e as Error)?.message || e)}`)
      return
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      res.statusCode = 400
      res.end('upstream must be http(s)')
      return
    }

    const isHttps = targetUrl.protocol === 'https:'
    const lib = isHttps ? https : http
    const port =
      targetUrl.port ||
      (isHttps ? '443' : '80')
    const headers = sanitizeProxyHeaders(req.headers)
    headers.host = targetUrl.host
    headers.origin = targetUrl.origin
    headers.referer = `${targetUrl.origin}/`

    const opts: https.RequestOptions = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method || 'GET',
      headers,
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    }

    const pReq = lib.request(opts, (pRes) => {
      const outHeaders = { ...pRes.headers } as http.OutgoingHttpHeaders
      delete outHeaders['transfer-encoding']
      delete outHeaders.connection
      res.writeHead(pRes.statusCode || 502, outHeaders)
      pRes.pipe(res)
    })
    pReq.on('error', (err) => {
      if (!res.headersSent) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(`Comfy dev proxy: ${String((err as Error)?.message || err)}`)
      }
    })
    req.pipe(pReq)
  })
}

export function comfyDevProxyPlugin(): Plugin {
  return {
    name: 'flowid-comfy-dev-proxy',
    enforce: 'pre',
    configureServer(server) {
      mountComfyDevProxy(server.middlewares)
    },
    configurePreviewServer(server) {
      mountComfyDevProxy(server.middlewares)
    },
  }
}
