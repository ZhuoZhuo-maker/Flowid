/**
 * Flowid 前端工程（Vite）。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage } from 'node:http'
import type { ProxyOptions } from 'vite'
import { decodeComfyDevProxyBaseSegment } from './src/lib/comfyDevProxyCodec'
import { mlSharpDevServer } from './plugins/mlSharpDevServer'

type DevRemoteProxyOptions = ProxyOptions & {
  router?: (req: IncomingMessage) => string
}

const comfyLocalProxy: ProxyOptions = {
  target: 'http://127.0.0.1:8188',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/__comfy_local__/, ''),
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      // 某些 ComfyUI 安全策略会基于 Origin/Referer 拒绝非同源写请求（403）
      proxyReq.setHeader('origin', 'http://127.0.0.1:8188')
      proxyReq.setHeader('referer', 'http://127.0.0.1:8188/')
    })
  },
}

/** 开发态：任意 http(s) Comfy baseUrl 经同源路径转发，避免浏览器直连远端触发 CORS（如参考图上传 /upload/image）。 */
const comfyDevRemoteProxy: DevRemoteProxyOptions = {
  target: 'http://127.0.0.1:1',
  changeOrigin: true,
  router: (req: IncomingMessage) => {
    try {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
      const m = pathname.match(/^\/__comfy_dev_proxy__\/([^/]+)/)
      if (!m) return 'http://127.0.0.1:1'
      const decoded = decodeComfyDevProxyBaseSegment(m[1])
      const u = new URL(decoded)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'http://127.0.0.1:1'
      const pathNoSlash = u.pathname.replace(/\/+$/, '')
      return `${u.protocol}//${u.host}${pathNoSlash}`
    } catch {
      return 'http://127.0.0.1:1'
    }
  },
  rewrite: (pathStr) => {
    try {
      const u = new URL(pathStr, 'http://127.0.0.1')
      const rest = u.pathname.replace(/^\/__comfy_dev_proxy__\/[^/]+/, '') || '/'
      return rest + u.search
    } catch {
      return pathStr
    }
  },
  configure: (proxy) => {
    proxy.on('proxyReq', (proxyReq, req) => {
      try {
        const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
        const m = pathname.match(/^\/__comfy_dev_proxy__\/([^/]+)/)
        if (!m) return
        const base = decodeComfyDevProxyBaseSegment(m[1])
        const origin = new URL(base).origin
        proxyReq.setHeader('origin', origin)
        proxyReq.setHeader('referer', `${origin}/`)
      } catch {
        // ignore
      }
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  // Electron 打包后使用 file:// 加载 dist/index.html，需要相对资源路径（否则 /assets 会指向磁盘根目录导致黑屏）
  base: './',
  plugins: [react(), tailwindcss(), mlSharpDevServer()],
  server: {
    /** 固定本机 IPv4，与 `localhost` 分属不同浏览器来源；与默认存档、工作流 localStorage 一致 */
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/__comfy_local__': comfyLocalProxy,
      '/__comfy_dev_proxy__': comfyDevRemoteProxy,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/__comfy_local__': comfyLocalProxy,
      '/__comfy_dev_proxy__': comfyDevRemoteProxy,
    },
  },
})
