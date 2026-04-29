import { loadAuthApiConfig } from './auth'

type ProxyRequest = {
  url: string
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  json?: unknown
}

const DEFAULT_AUTH_PROXY_BASES = ['http://127.0.0.1:3721', 'http://localhost:3721'] as const

function getOpenAiProxyUrlCandidates(): string[] {
  const configured = String(loadAuthApiConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
  const bases: string[] = []
  if (configured) bases.push(configured)
  for (const d of DEFAULT_AUTH_PROXY_BASES) {
    if (!bases.includes(d)) bases.push(d)
  }
  return bases.map((b) => `${b}/proxy/openai`)
}

/**
 * 外网 OpenAI 兼容地址：在纯网页里会因 CORS 需走同源代理；在 Electron 里改由主进程直连。
 */
function requiresCrossOriginVendorRequest(targetUrl: string): boolean {
  try {
    const u = new URL(targetUrl)
    if (typeof window !== 'undefined' && window.location && u.origin === window.location.origin) return false
    const host = u.hostname.toLowerCase()
    if (host === '127.0.0.1' || host === 'localhost') return false
    return true
  } catch {
    return false
  }
}

function hasDesktopOpenAiBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.flowidDesktop?.openAiCompatFetch)
}

function ipcBodyToArrayBuffer(body: unknown): ArrayBuffer {
  if (body instanceof ArrayBuffer) return body
  if (body instanceof Uint8Array) {
    // Uint8Array#buffer 可能是 SharedArrayBuffer；这里拷贝为标准 ArrayBuffer 以满足 TS 类型与 Response 期望
    return body.slice().buffer
  }
  if (ArrayBuffer.isView(body)) {
    const v = body as ArrayBufferView
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer
  }
  return new ArrayBuffer(0)
}

async function fetchOpenAICompatViaDesktopMain(
  target: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; json?: unknown },
): Promise<Response> {
  const desk = window.flowidDesktop
  if (!desk?.openAiCompatFetch) {
    throw new Error('openAiCompatFetch unavailable')
  }
  const result = await desk.openAiCompatFetch({
    url: target,
    method: init.method,
    headers: init.headers,
    json: init.json,
  })
  if (!result.ok) {
    throw new Error(result.error || 'desktop-openai-fetch-failed')
  }
  const body = ipcBodyToArrayBuffer(result.body)
  return new Response(body, {
    status: result.status,
    statusText: result.statusText || '',
    headers: new Headers(result.headers as HeadersInit),
  })
}

export async function fetchOpenAICompat(
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; json?: unknown },
): Promise<Response> {
  const target = String(url || '').trim()
  if (!target) return await fetch(target)

  const crossOriginVendor = requiresCrossOriginVendorRequest(target)

  if (hasDesktopOpenAiBridge() && crossOriginVendor) {
    return await fetchOpenAICompatViaDesktopMain(target, init)
  }

  if (!crossOriginVendor) {
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
  const proxyCandidates = getOpenAiProxyUrlCandidates()
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
    `Proxy endpoint not found (${statusText}). Tried: ${tried}. Web 版需认证服务提供 POST /proxy/openai；或在桌面端使用 Flowid 可直连厂商。`,
  )
}
