/**
 * 本地打包：预设模板 + 灵感小镇走随包静态资源（JSON/封面），不向授权服务拉列表与大图，省流量。
 * 构建时设置 VITE_FLOWID_LOCAL_GALLERY=1（见 npm run pack:desktop / cross-env）。
 *
 * 资源目录：public/flowid-bundled/ → 构建后位于 dist/flowid-bundled/（Electron base 为 ./，用当前页 URL 解析）
 */
export function isLocalGalleryBundleEnabled(): boolean {
  return String(import.meta.env.VITE_FLOWID_LOCAL_GALLERY || '').trim() === '1'
}

/** 将「相对于 dist 根」的路径解析为可 fetch / <img> 的绝对 URL（兼容 file:// 与 http） */
export function resolveBundledGalleryUrl(pathRelativeToDistRoot: string): string {
  const p = String(pathRelativeToDistRoot || '').replace(/^\.?\/+/, '')
  const base = import.meta.env.BASE_URL || './'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const rel = `${normalizedBase}${p}`
  if (typeof window === 'undefined') return rel
  try {
    return new URL(rel, window.location.href).href
  } catch {
    return rel
  }
}

export async function fetchBundledJson<T>(pathRelativeToDistRoot: string): Promise<T | null> {
  const url = resolveBundledGalleryUrl(pathRelativeToDistRoot)
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
