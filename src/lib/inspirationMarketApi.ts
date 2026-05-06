import { loadLicenseServerConfig } from './licenseAccess'

export type InspirationMarketMeta = {
  categories: string[]
  serverTimeMs: number
}

export type InspirationListItem = {
  id: string
  title: string
  description: string
  category: string
  /** 相对路径，需拼 baseUrl */
  imageUrl: string
}

export type InspirationDetail = InspirationListItem & {
  promptText: string
}

function authBase(): string {
  return String(loadLicenseServerConfig().baseUrl || '')
    .trim()
    .replace(/\/+$/, '') || 'http://127.0.0.1:3721'
}

export function inspirationAbsoluteUrl(relativeOrAbsolute: string): string {
  const u = String(relativeOrAbsolute || '').trim()
  if (!u) return ''
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  const b = authBase()
  if (u.startsWith('/')) return `${b}${u}`
  return `${b}/${u}`
}

export async function fetchInspirationMeta(): Promise<InspirationMarketMeta | null> {
  const res = await fetch(`${authBase()}/inspiration-market/meta`)
  if (!res.ok) return null
  return (await res.json()) as InspirationMarketMeta
}

export async function fetchInspirationList(category?: string): Promise<{
  items: InspirationListItem[]
  serverTimeMs: number
} | null> {
  const q = category && category !== '全部' ? `?category=${encodeURIComponent(category)}` : ''
  const res = await fetch(`${authBase()}/inspiration-market/list${q}`)
  if (!res.ok) return null
  const j = (await res.json()) as { items?: InspirationListItem[]; serverTimeMs?: number }
  return { items: Array.isArray(j.items) ? j.items : [], serverTimeMs: Number(j.serverTimeMs) || 0 }
}

export async function fetchInspirationItem(id: string): Promise<InspirationDetail | null> {
  const res = await fetch(`${authBase()}/inspiration-market/item/${encodeURIComponent(id)}`)
  if (!res.ok) return null
  return (await res.json()) as InspirationDetail
}
