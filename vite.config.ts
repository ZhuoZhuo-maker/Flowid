/**
 * Flowid 前端工程（Vite）。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { ProxyOptions } from 'vite'
import { comfyDevProxyPlugin } from './plugins/comfyDevProxyPlugin'
import { mlSharpDevServer } from './plugins/mlSharpDevServer'

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

// https://vite.dev/config/
export default defineConfig({
  // Electron 打包后使用 file:// 加载 dist/index.html，需要相对资源路径（否则 /assets 会指向磁盘根目录导致黑屏）
  base: './',
  plugins: [comfyDevProxyPlugin(), react(), tailwindcss(), mlSharpDevServer()],
  server: {
    /** 固定本机 IPv4，与 `localhost` 分属不同浏览器来源；与默认存档、工作流 localStorage 一致 */
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/pts': { target: 'http://127.0.0.1:3721', changeOrigin: true },
      '/__comfy_local__': comfyLocalProxy,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/pts': { target: 'http://127.0.0.1:3721', changeOrigin: true },
      '/__comfy_local__': comfyLocalProxy,
    },
  },
})
