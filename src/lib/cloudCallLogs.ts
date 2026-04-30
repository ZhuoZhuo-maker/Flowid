import type { StudioNodeKind } from '../types'

export type CloudCallLogEntry = {
  ts: number
  nodeKind: StudioNodeKind | string
  model: string
  count: number
}

const KEY = 'flowid.cloud.callLogs.v1'
const KEEP_MS = 3 * 24 * 60 * 60 * 1000
const MAX_ITEMS = 500

function safeParse(raw: string | null): CloudCallLogEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => ({
        ts: Number((x as any)?.ts || 0),
        nodeKind: String((x as any)?.nodeKind || ''),
        model: String((x as any)?.model || ''),
        count: Math.max(1, Number((x as any)?.count || 1)),
      }))
      .filter((x) => Number.isFinite(x.ts) && x.ts > 0 && x.model)
  } catch {
    return []
  }
}

export function loadCloudCallLogs(): CloudCallLogEntry[] {
  const now = Date.now()
  const cut = now - KEEP_MS
  let list: CloudCallLogEntry[] = []
  try {
    list = safeParse(window.localStorage.getItem(KEY))
  } catch {
    list = []
  }
  const next = list.filter((x) => x.ts >= cut).sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS)
  // best-effort prune persistence
  try {
    if (next.length !== list.length) window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  return next
}

export function appendCloudCallLog(entry: { nodeKind: StudioNodeKind | string; model: string; count?: number }) {
  const now = Date.now()
  const e: CloudCallLogEntry = {
    ts: now,
    nodeKind: String(entry.nodeKind || ''),
    model: String(entry.model || '').trim(),
    count: Math.max(1, Number(entry.count || 1)),
  }
  if (!e.model) return
  const prev = loadCloudCallLogs()
  const next = [e, ...prev].slice(0, MAX_ITEMS)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent('flowid:cloud-call-logs-changed'))
  } catch {
    // ignore
  }
}

