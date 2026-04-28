type ProxyRequest = {
  url: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  json?: unknown
}

function shouldUseProxy(targetUrl: string): boolean {
  try {
    const u = new URL(targetUrl)
    // If it's same-origin, no need.
    if (typeof window !== 'undefined' && window.location && u.origin === window.location.origin) return false
    // For localhost endpoints, direct fetch is fine.
    const host = u.hostname.toLowerCase()
    if (host === '127.0.0.1' || host === 'localhost') return false
    // Otherwise, use proxy to avoid CORS in browser/electron renderer.
    return true
  } catch {
    return false
  }
}

export async function fetchOpenAICompat(url: string, init: { method: 'GET' | 'POST'; headers?: Record<string, string>; json?: unknown }): Promise<Response> {
  const target = String(url || '').trim()
  if (!target) return await fetch(target)
  if (!shouldUseProxy(target)) {
    return await fetch(target, {
      method: init.method,
      headers: init.headers,
      body: init.json != null && init.method !== 'GET' ? JSON.stringify(init.json) : undefined,
    })
  }
  const payload: ProxyRequest = {
    url: target,
    method: init.method,
    headers: init.headers,
    json: init.json,
  }
  const proxyCandidates = ['http://127.0.0.1:3721/proxy/openai', 'http://localhost:3721/proxy/openai']
  let lastRes: Response | null = null
  for (const proxyUrl of proxyCandidates) {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    lastRes = res
    if (res.status === 404) continue
    return res
  }
  const tried = proxyCandidates.join(', ')
  const statusText = lastRes ? `HTTP ${lastRes.status}` : 'NO_RESPONSE'
  throw new Error(
    `Proxy endpoint not found (${statusText}). Tried: ${tried}. The local auth server is likely not updated/restarted; please restart auth-dev so /proxy/openai is registered.`,
  )
}

