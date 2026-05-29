import type { CloudWorkflowOverrideEntry, StudioNodeKind } from '../types'
import { fetchCloudWorkflowJson, fetchCloudWorkflowsMeta } from './cloudWorkflowsApi'
import { joinDiskPath, sanitizePromptTitleForFilename } from './systemPromptCoverPaths'

/** 固定落盘目录：将软件内本地/云端 Comfy 工作流 API JSON 复制到此（非设置项） */
const COMFY_API_BACKUP_ROOT = 'F:\\flowid(comfyui工作流api备份)'
export const LOCAL_COMFY_WORKFLOW_API_MIRROR_DIR = `${COMFY_API_BACKUP_ROOT}\\本地comfyui_api`
export const CLOUD_COMFY_WORKFLOW_API_MIRROR_DIR = `${COMFY_API_BACKUP_ROOT}\\云端comfyui_api`
import { loadWorkflowConfig, type WorkflowConfigSnapshot } from './workflowConfigStorage'

const STUDIO_NODE_KINDS: StudioNodeKind[] = [
  'text',
  'script',
  'image',
  'imageCompare',
  'video',
  'audio',
  'music',
  'panorama',
]

/** 单条待落盘的工作流 API JSON */
export type ComfyWorkflowApiBackupEntry = {
  id: string
  name: string
  jsonText: string
  nodeKind?: StudioNodeKind
  source?: 'local-list' | 'local-draft' | 'cloud-auth' | 'cloud-override'
}

export type ComfyWorkflowApiBackupResult = {
  ok: boolean
  rootDir: string
  wroteCount: number
  skippedCount: number
  message?: string
}

export type ComfyWorkflowApiBackupManifest = {
  exportedAtMs: number
  kind: 'local' | 'cloud'
  reason?: string
  rootDir: string
  entries: Array<{
    relativePath: string
    id: string
    name: string
    nodeKind?: string
    source?: string
  }>
}

let backupDebounceTimer: ReturnType<typeof setTimeout> | null = null
let backupInFlight: Promise<ComfyWorkflowApiBackupBothResult> | null = null

export type ComfyWorkflowApiBackupBothResult = {
  local: ComfyWorkflowApiBackupResult
  cloud: ComfyWorkflowApiBackupResult
}

/**
 * 是否具备桌面端写盘能力（备份目录在 F:\ 等绝对路径上依赖此项）。
 */
export function canWriteComfyWorkflowApiBackupToDisk(): boolean {
  if (typeof window === 'undefined') return false
  const desk = window.flowidDesktop
  return Boolean(desk?.ensureDirectory && desk?.writeUtf8File)
}

/**
 * 从工作流配置汇总「本地 Comfy」导入列表中的 API JSON。
 */
export function collectLocalComfyWorkflowApiEntries(
  config: WorkflowConfigSnapshot = loadWorkflowConfig(),
): ComfyWorkflowApiBackupEntry[] {
  const seen = new Set<string>()
  const out: ComfyWorkflowApiBackupEntry[] = []

  for (const nodeKind of STUDIO_NODE_KINDS) {
    const cfg = config.nodeConfigs[nodeKind]
    for (const item of cfg.workflows) {
      const jsonText = String(item.jsonText || '').trim()
      if (!jsonText) continue
      const id = String(item.id || '').trim() || crypto.randomUUID()
      const dedupeKey = `${nodeKind}:${id}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      out.push({
        id,
        name: String(item.name || '').trim() || id,
        jsonText,
        nodeKind,
        source: 'local-list',
      })
    }

    const draftText = String(cfg.workflowJsonText || '').trim()
    if (!draftText) continue
    const selected = cfg.workflows.find((w) => w.id === cfg.selectedWorkflowId)
    const selectedJson = String(selected?.jsonText || '').trim()
    if (selectedJson === draftText) continue
    const draftId = `draft-${nodeKind}`
    const dedupeKey = `${nodeKind}:${draftId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({
      id: draftId,
      name: String(cfg.workflowName || '').trim() || `当前编辑-${nodeKind}`,
      jsonText: draftText,
      nodeKind,
      source: 'local-draft',
    })
  }

  return out
}

/**
 * 在全部节点配置中查找某云端工作流 id 的本机覆盖 JSON。
 */
export function findCloudWorkflowOverrideJsonText(
  config: WorkflowConfigSnapshot,
  workflowId: string,
): string | undefined {
  const id = String(workflowId || '').trim()
  if (!id) return undefined
  for (const nodeKind of STUDIO_NODE_KINDS) {
    const raw = config.nodeConfigs[nodeKind].cloudWorkflowOverrides?.[id]
    const text = cloudOverrideEntryToJsonText(raw)
    if (text) return text
  }
  return undefined
}

function cloudOverrideEntryToJsonText(
  raw: string | CloudWorkflowOverrideEntry | undefined,
): string | undefined {
  if (!raw) return undefined
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t || undefined
  }
  const t = String(raw.jsonText || '').trim()
  return t || undefined
}

function workflowApiFileLeaf(id: string, name: string): string {
  const safeId = sanitizePromptTitleForFilename(id)
  const safeName = sanitizePromptTitleForFilename(name)
  return `${safeId}__${safeName}.json`
}

function formatWorkflowJsonForDisk(jsonText: string): string {
  const raw = String(jsonText || '').trim()
  if (!raw) return ''
  try {
    return `${JSON.stringify(JSON.parse(raw), null, 2)}\n`
  } catch {
    return raw.endsWith('\n') ? raw : `${raw}\n`
  }
}

async function writeBackupEntriesToDir(
  rootDir: string,
  kind: 'local' | 'cloud',
  entries: ComfyWorkflowApiBackupEntry[],
  reason?: string,
): Promise<ComfyWorkflowApiBackupResult> {
  const root = String(rootDir || '').trim()
  if (!root) {
    return { ok: false, rootDir: '', wroteCount: 0, skippedCount: 0, message: '备份目录未配置' }
  }
  if (!canWriteComfyWorkflowApiBackupToDisk()) {
    return {
      ok: false,
      rootDir: root,
      wroteCount: 0,
      skippedCount: entries.length,
      message: '当前环境无法写入磁盘（请使用 Flowid 桌面版）',
    }
  }

  const desk = window.flowidDesktop!
  const ensured = await desk.ensureDirectory!(root)
  if (!ensured.ok) {
    return {
      ok: false,
      rootDir: root,
      wroteCount: 0,
      skippedCount: entries.length,
      message: ensured.error || '创建备份目录失败',
    }
  }

  const manifestEntries: ComfyWorkflowApiBackupManifest['entries'] = []
  let wroteCount = 0
  let skippedCount = 0

  for (const entry of entries) {
    const jsonText = String(entry.jsonText || '').trim()
    if (!jsonText) {
      skippedCount += 1
      continue
    }
    const leaf = workflowApiFileLeaf(entry.id, entry.name)
    const relativePath =
      kind === 'local' && entry.nodeKind
        ? joinDiskPath(entry.nodeKind, leaf)
        : leaf
    const filePath = joinDiskPath(root, relativePath)
    const parent = filePath.replace(/[\\/][^\\/]+$/, '')
    if (parent && parent !== filePath) {
      const parentEnsured = await desk.ensureDirectory!(parent)
      if (!parentEnsured.ok) {
        skippedCount += 1
        continue
      }
    }
    const body = formatWorkflowJsonForDisk(jsonText)
    const written = await desk.writeUtf8File!(filePath, body)
    if (!written.ok) {
      skippedCount += 1
      continue
    }
    wroteCount += 1
    manifestEntries.push({
      relativePath,
      id: entry.id,
      name: entry.name,
      nodeKind: entry.nodeKind,
      source: entry.source,
    })
  }

  const manifest: ComfyWorkflowApiBackupManifest = {
    exportedAtMs: Date.now(),
    kind,
    reason,
    rootDir: root,
    entries: manifestEntries,
  }
  const manifestPath = joinDiskPath(root, 'manifest.json')
  await desk.writeUtf8File!(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return {
    ok: wroteCount > 0 || entries.length === 0,
    rootDir: root,
    wroteCount,
    skippedCount,
    message:
      wroteCount === 0 && entries.length > 0
        ? '没有成功写入任何工作流文件'
        : undefined,
  }
}

/**
 * 将软件内「本地工作流」列表复制到固定目录。
 */
export async function backupLocalComfyWorkflowApisToDisk(opts?: {
  config?: WorkflowConfigSnapshot
  rootDir?: string
  reason?: string
}): Promise<ComfyWorkflowApiBackupResult> {
  const rootDir = String(opts?.rootDir || '').trim() || LOCAL_COMFY_WORKFLOW_API_MIRROR_DIR
  const config = opts?.config ?? loadWorkflowConfig()
  const entries = collectLocalComfyWorkflowApiEntries(config)
  return writeBackupEntriesToDir(rootDir, 'local', entries, opts?.reason)
}

/**
 * 将软件内「云端工作流」（授权服务 / 随包 + 本机覆盖）复制到固定目录。
 */
export async function backupCloudComfyWorkflowApisToDisk(opts?: {
  config?: WorkflowConfigSnapshot
  rootDir?: string
  reason?: string
}): Promise<ComfyWorkflowApiBackupResult> {
  const rootDir = String(opts?.rootDir || '').trim() || CLOUD_COMFY_WORKFLOW_API_MIRROR_DIR
  const config = opts?.config ?? loadWorkflowConfig()
  const metaList = await fetchCloudWorkflowsMeta()
  const entries: ComfyWorkflowApiBackupEntry[] = []

  for (const meta of metaList) {
    const overrideText = findCloudWorkflowOverrideJsonText(config, meta.id)
    if (overrideText) {
      entries.push({
        id: meta.id,
        name: meta.name,
        jsonText: overrideText,
        nodeKind: meta.nodeKind as StudioNodeKind | undefined,
        source: 'cloud-override',
      })
      continue
    }
    const remote = await fetchCloudWorkflowJson(meta.id)
    if (!remote.ok || !String(remote.workflowJson || '').trim()) continue
    entries.push({
      id: remote.id || meta.id,
      name: remote.name || meta.name,
      jsonText: remote.workflowJson,
      nodeKind: meta.nodeKind as StudioNodeKind | undefined,
      source: 'cloud-auth',
    })
  }

  return writeBackupEntriesToDir(rootDir, 'cloud', entries, opts?.reason)
}

/**
 * 同时将本地与云端 Comfy 工作流 API 复制到 F: 固定目录。
 */
export async function runComfyWorkflowApiBackupBoth(opts?: {
  config?: WorkflowConfigSnapshot
  reason?: string
}): Promise<ComfyWorkflowApiBackupBothResult> {
  if (backupInFlight) return backupInFlight
  backupInFlight = (async () => {
    const local = await backupLocalComfyWorkflowApisToDisk(opts)
    const cloud = await backupCloudComfyWorkflowApisToDisk(opts)
    return { local, cloud }
  })().finally(() => {
    backupInFlight = null
  })
  return backupInFlight
}

/**
 * 防抖触发同步复制（工作流配置变更后写入 F: 固定目录）。
 */
export function requestComfyWorkflowApiBackupDebounced(reason = 'config-changed'): void {
  if (!canWriteComfyWorkflowApiBackupToDisk()) return
  if (backupDebounceTimer) clearTimeout(backupDebounceTimer)
  backupDebounceTimer = setTimeout(() => {
    backupDebounceTimer = null
    void runComfyWorkflowApiBackupBoth({ reason })
  }, 2500)
}

/**
 * 应用启动后空闲时将当前工作流复制到 F: 固定目录。
 */
export function requestComfyWorkflowApiBackupOnIdle(reason = 'startup'): void {
  if (!canWriteComfyWorkflowApiBackupToDisk()) return
  const run = () => void runComfyWorkflowApiBackupBoth({ reason })
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 8000 })
  } else {
    setTimeout(run, 1500)
  }
}
