/* global FlowidAdminState */
;(function () {
  const loadingEl = () => document.getElementById('admin-global-loading')
  let loadingCount = 0

  function setLoading(on) {
    const el = loadingEl()
    if (!el) return
    if (on) {
      loadingCount += 1
      el.classList.add('is-on')
    } else {
      loadingCount = Math.max(0, loadingCount - 1)
      if (loadingCount === 0) el.classList.remove('is-on')
    }
  }

  const toastHost = () => document.getElementById('admin-toast-host')

  window.FlowidAdminToast = function (message, isError) {
    const host = toastHost()
    if (!host) {
      if (isError) window.alert(String(message))
      return
    }
    const div = document.createElement('div')
    div.className = 'admin-toast' + (isError ? ' err' : '')
    div.textContent = String(message || '')
    host.appendChild(div)
    window.setTimeout(() => {
      try {
        div.remove()
      } catch (_) {}
    }, 4200)
  }

  function adminHeaders() {
    const t = window.FlowidAdminState && window.FlowidAdminState.getAdminToken()
    const h = {}
    if (t) h['x-admin-token'] = t
    return h
  }

  async function parseBody(res) {
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return res.json().catch(() => ({}))
    const t = await res.text().catch(() => '')
    try {
      return JSON.parse(t)
    } catch {
      return { raw: t }
    }
  }

  async function request(method, path, body) {
    setLoading(true)
    try {
      const opts = {
        method,
        headers: { ...adminHeaders() },
      }
      if (body !== undefined && body !== null) {
        opts.headers['Content-Type'] = 'application/json'
        opts.body = JSON.stringify(body)
      }
      const res = await fetch(path, opts)
      const json = await parseBody(res)
      if (!res.ok) {
        const msg = json && json.message ? String(json.message) : `HTTP ${res.status}`
        throw new Error(msg)
      }
      return json
    } finally {
      setLoading(false)
    }
  }

  window.FlowidAdminApi = {
    adminHeaders,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
  }
})()
