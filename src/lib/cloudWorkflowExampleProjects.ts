import type { ProjectSnapshot } from '../types'

/** 与 `ProjectSnapshot` 一致，不含工程元信息字段 */
export type CloudWorkflowExampleCanvasSnapshot = Omit<ProjectSnapshot, 'version' | 'name'>

export type CloudWorkflowExampleEntry = {
  id: string
  name: string
  savedAt: number
  /** 保存时底部面板节点类型 */
  nodeKind?: string
  snapshot: CloudWorkflowExampleCanvasSnapshot
}

const STORAGE_KEY = 'flowid.cloudWorkflow.exampleProjects.v1'
const MAX_PER_WORKFLOW = 10

function parseMap(raw: unknown): Record<string, CloudWorkflowExampleEntry[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, CloudWorkflowExampleEntry[]> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const wid = String(k || '').trim()
    if (!wid) continue
    if (!Array.isArray(v)) continue
    const list: CloudWorkflowExampleEntry[] = []
    for (const item of v) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const id = String(rec.id || '').trim()
      const name = String(rec.name || '').trim()
      const savedAt = typeof rec.savedAt === 'number' ? rec.savedAt : 0
      const nodeKind = typeof rec.nodeKind === 'string' ? rec.nodeKind : undefined
      const snap = rec.snapshot
      if (!id || !snap || typeof snap !== 'object') continue
      list.push({
        id,
        name: name || '未命名示例',
        savedAt,
        nodeKind,
        snapshot: snap as CloudWorkflowExampleCanvasSnapshot,
      })
    }
    if (list.length) out[wid] = list
  }
  return out
}

export function loadCloudWorkflowExampleMap(): Record<string, CloudWorkflowExampleEntry[]> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return parseMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

function saveCloudWorkflowExampleMap(map: Record<string, CloudWorkflowExampleEntry[]>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function listCloudWorkflowExamples(workflowId: string): CloudWorkflowExampleEntry[] {
  const wid = String(workflowId || '').trim()
  if (!wid) return []
  const list = loadCloudWorkflowExampleMap()[wid] ?? []
  return [...list].sort((a, b) => b.savedAt - a.savedAt)
}

export function pinCloudWorkflowExample(
  workflowId: string,
  payload: { name: string; snapshot: CloudWorkflowExampleCanvasSnapshot; nodeKind?: string },
): { ok: true } | { ok: false; message: string } {
  const wid = String(workflowId || '').trim()
  if (!wid) return { ok: false, message: '未选择工作流，无法保存示例' }
  const name = String(payload.name || '').trim() || '未命名示例'
  const map = loadCloudWorkflowExampleMap()
  const prev = map[wid] ?? []
  const entry: CloudWorkflowExampleEntry = {
    id: crypto.randomUUID(),
    name,
    savedAt: Date.now(),
    nodeKind: payload.nodeKind,
    snapshot: structuredClone(payload.snapshot),
  }
  const next = [entry, ...prev].slice(0, MAX_PER_WORKFLOW)
  map[wid] = next
  try {
    saveCloudWorkflowExampleMap(map)
    return { ok: true }
  } catch {
    return {
      ok: false,
      message: '保存失败（可能示例过多或画布过大）：请删除旧示例或简化工程后重试。',
    }
  }
}

export function removeCloudWorkflowExample(workflowId: string, entryId: string): void {
  const wid = String(workflowId || '').trim()
  const eid = String(entryId || '').trim()
  if (!wid || !eid) return
  const map = loadCloudWorkflowExampleMap()
  const list = map[wid]
  if (!list?.length) return
  const next = list.filter((x) => x.id !== eid)
  if (next.length) map[wid] = next
  else delete map[wid]
  try {
    saveCloudWorkflowExampleMap(map)
  } catch {
    // ignore
  }
}
