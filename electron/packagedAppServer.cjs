/**
 * 打包态 Electron：在本机起静态 HTTP 服务并挂载 Comfy 同源反代，避免 file:// 直连 Comfy 触发 CORS/PNA。
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { handleComfyLocalProxy, handleComfyDevProxy } = require('./comfyProxyHandlers.cjs')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
}

/** @type {import('node:http').Server | null} */
let activeServer = null

/**
 * @param {string} distDir
 * @param {URL} incoming
 * @returns {string | null}
 */
function resolveStaticFile(distDir, incoming) {
  let rel = decodeURIComponent(incoming.pathname || '/')
  if (rel === '/' || rel === '') rel = '/index.html'
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '')
  const abs = path.join(distDir, normalized)
  if (!abs.startsWith(path.resolve(distDir))) return null
  return abs
}

/**
 * @param {string} distDir
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function serveStatic(distDir, req, res, incoming) {
  const filePath = resolveStaticFile(distDir, incoming)
  if (!filePath) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  try {
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) throw new Error('not-file')
    const ext = path.extname(filePath).toLowerCase()
    res.statusCode = 200
    if (MIME[ext]) res.setHeader('Content-Type', MIME[ext])
    fs.createReadStream(filePath).pipe(res)
  } catch {
    const indexPath = path.join(distDir, 'index.html')
    try {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      fs.createReadStream(indexPath).pipe(res)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  }
}

/**
 * @param {{ distDir: string, preferredPort?: number }} opts
 * @returns {Promise<string>} 如 http://127.0.0.1:53173/
 */
function startPackagedAppServer(opts) {
  const distDir = path.resolve(String(opts.distDir || ''))
  const preferredPort = Number(opts.preferredPort || 53173)

  return new Promise((resolve, reject) => {
    if (activeServer) {
      const addr = activeServer.address()
      if (addr && typeof addr === 'object') {
        resolve(`http://127.0.0.1:${addr.port}/`)
        return
      }
    }

    const handler = (req, res) => {
      let incoming
      try {
        incoming = new URL(req.url || '/', 'http://127.0.0.1')
      } catch {
        res.statusCode = 400
        res.end('bad request')
        return
      }
      if (handleComfyLocalProxy(req, res, incoming)) return
      if (handleComfyDevProxy(req, res, incoming)) return
      void serveStatic(distDir, req, res, incoming)
    }

    const server = http.createServer(handler)

    const onListening = () => {
      activeServer = server
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : preferredPort
      console.log(`[Flowid] packaged app server at http://127.0.0.1:${port}/`)
      resolve(`http://127.0.0.1:${port}/`)
    }

    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1', onListening)
        return
      }
      reject(err)
    })

    server.listen(preferredPort, '127.0.0.1', onListening)
  })
}

function stopPackagedAppServer() {
  if (activeServer) {
    activeServer.close()
    activeServer = null
  }
}

module.exports = { startPackagedAppServer, stopPackagedAppServer }
