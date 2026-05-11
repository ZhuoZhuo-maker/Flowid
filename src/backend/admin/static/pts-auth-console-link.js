/**
 * Auth 控制台在 Auth 进程根路径 /admin.html。经 Vite(5173/4173) 打开积分总览时，同源 /admin.html 不会代理到 3721，需显式跳到 Auth 监听端口。
 * 独立积分进程 (points:dev) 无 Auth 页：依赖 AUTH_CONSOLE_PUBLIC_URL 或提示用户。
 */
;(function () {
  function viteDevPorts(port) {
    return port === '5173' || port === '4173'
  }

  async function resolveAuthConsoleUrl() {
    const apiBase = String(location.origin || '').replace(/\/+$/, '') + '/pts'
    const res = await fetch(apiBase + '/api/public/auth-console')
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = j && j.message ? String(j.message) : 'HTTP ' + res.status
      throw new Error(msg)
    }
    let url = j.authConsoleUrl ? String(j.authConsoleUrl) : ''
    const port = String(location.port || '')
    if (viteDevPorts(port) && j.source === 'colocated' && j.authListenPort) {
      url = `${location.protocol}//${location.hostname}:${j.authListenPort}/admin.html`
    }
    return { url, message: j.message ? String(j.message) : '' }
  }

  async function openAuthConsole(ev) {
    if (ev.defaultPrevented) return
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
    if (typeof ev.button === 'number' && ev.button !== 0) return
    ev.preventDefault()
    try {
      const { url, message } = await resolveAuthConsoleUrl()
      if (!url) {
        window.alert(
          message ||
            '当前进程未挂载 Auth 控制台。请运行 npm run auth:dev，或在环境中设置 AUTH_CONSOLE_PUBLIC_URL（完整 admin.html URL）。',
        )
        return
      }
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      window.alert('无法打开 Auth 控制台：' + String((e && e.message) || e))
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const a = document.getElementById('flowidAuthConsoleCard')
    if (a) a.addEventListener('click', openAuthConsole)
  })
})()
