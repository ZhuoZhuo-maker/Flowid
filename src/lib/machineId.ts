function hashStringToId(input: string): string {
  const s = String(input || '')
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `MID-${(h >>> 0).toString(16)}`
}

let cached: string | null = null
let inflight: Promise<string> | null = null

/**
 * 获取当前设备机器码（优先桌面端主进程提供；网页环境回退为轻量 hash）。
 */
export async function getMachineId(): Promise<string> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const desk = window.flowidDesktop
      const mid = (await desk?.getMachineId?.()) || ''
      const trimmed = String(mid || '').trim()
      if (trimmed) {
        cached = trimmed
        return trimmed
      }
    } catch {
      // ignore
    }
    const fallback = hashStringToId(`${navigator.userAgent}|${navigator.language}|${navigator.platform}`)
    cached = fallback
    return fallback
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

