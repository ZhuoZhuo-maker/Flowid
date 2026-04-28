/** Flowid 应用入口 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * 开发期控制台降噪：过滤已知且可自愈的浏览器/HMR 噪声异常，避免无限刷屏影响排障。
 */
function installDevNoiseGuards() {
  if (!import.meta.env.DEV) return
  const isIgnoredNoise = (message: string): boolean => {
    const m = String(message || '')
    return (
      m.includes('ResizeObserver loop completed with undelivered notifications') ||
      m.includes('ResizeObserver loop limit exceeded') ||
      m.includes('send was called before connect')
    )
  }
  window.addEventListener('error', (event) => {
    if (isIgnoredNoise(event.message || '')) {
      event.preventDefault()
    }
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const text =
      typeof reason === 'string'
        ? reason
        : typeof reason?.message === 'string'
          ? reason.message
          : ''
    if (isIgnoredNoise(text)) {
      event.preventDefault()
    }
  })
}

installDevNoiseGuards()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
