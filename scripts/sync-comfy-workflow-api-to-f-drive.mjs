/**
 * 将 Flowid 内「云端工作流」（server/cloud-workflows.json）与「本地工作流」
 * （Electron localStorage / LevelDB 中的 flowid.workflow.config.v1）复制到固定目录：
 *
 *   F:\flowid(comfyui工作流api备份)\云端comfyui_api
 *   F:\flowid(comfyui工作流api备份)\本地comfyui_api
 *
 * 使用前若需读本机已导入的本地列表，请先完全退出 Flowid 桌面端（避免 LevelDB 锁）。
 *
 * @example
 * node scripts/sync-comfy-workflow-api-to-f-drive.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import leveldown from 'leveldown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const BACKUP_ROOT = 'F:\\flowid(comfyui工作流api备份)'
const CLOUD_OUT_DIR = path.join(BACKUP_ROOT, '云端comfyui_api')
const LOCAL_OUT_DIR = path.join(BACKUP_ROOT, '本地comfyui_api')

const STORAGE_KEY = 'flowid.workflow.config.v1'
const CLOUD_JSON = path.join(REPO_ROOT, 'server', 'cloud-workflows.json')

const NODE_KINDS = [
  'text',
  'script',
  'image',
  'imageCompare',
  'video',
  'audio',
  'music',
  'panorama',
]

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g

/**
 * @param {string} title
 */
function sanitizeFileName(title) {
  const t = String(title || '').trim() || 'untitled'
  return t.replace(INVALID_FILENAME_CHARS, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * @param {string} jsonText
 */
function formatJsonForDisk(jsonText) {
  const raw = String(jsonText || '').trim()
  if (!raw) return ''
  try {
    return `${JSON.stringify(JSON.parse(raw), null, 2)}\n`
  } catch {
    return raw.endsWith('\n') ? raw : `${raw}\n`
  }
}

/**
 * @param {string} rootDir
 * @param {'local' | 'cloud'} kind
 * @param {Array<{ id: string; name: string; jsonText: string; nodeKind?: string }>} entries
 */
function writeEntriesToDisk(rootDir, kind, entries) {
  fs.mkdirSync(rootDir, { recursive: true })
  const manifestEntries = []
  let wrote = 0

  for (const entry of entries) {
    const jsonText = String(entry.jsonText || '').trim()
    if (!jsonText) continue
    const leaf = `${sanitizeFileName(entry.id)}__${sanitizeFileName(entry.name)}.json`
    const relativePath =
      kind === 'local' && entry.nodeKind ? path.join(entry.nodeKind, leaf) : leaf
    const filePath = path.join(rootDir, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, formatJsonForDisk(jsonText), 'utf8')
    wrote++
    manifestEntries.push({
      relativePath: relativePath.replace(/\\/g, '/'),
      id: entry.id,
      name: entry.name,
      nodeKind: entry.nodeKind,
    })
  }

  fs.writeFileSync(
    path.join(rootDir, 'manifest.json'),
    `${JSON.stringify(
      {
        exportedAtMs: Date.now(),
        kind,
        rootDir,
        entries: manifestEntries,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return wrote
}

/**
 * @returns {Array<{ id: string; name: string; jsonText: string; nodeKind?: string }>}
 */
function collectLocalEntriesFromConfig(config) {
  /** @type {Array<{ id: string; name: string; jsonText: string; nodeKind?: string }>} */
  const out = []
  const seen = new Set()

  for (const nodeKind of NODE_KINDS) {
    const cfg = config?.nodeConfigs?.[nodeKind]
    if (!cfg || typeof cfg !== 'object') continue

    const workflows = Array.isArray(cfg.workflows) ? cfg.workflows : []
    for (const item of workflows) {
      if (!item || typeof item !== 'object') continue
      const jsonText = String(item.jsonText || '').trim()
      if (!jsonText) continue
      const id = String(item.id || '').trim() || `local-${nodeKind}-${out.length}`
      const key = `${nodeKind}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id,
        name: String(item.name || '').trim() || id,
        jsonText,
        nodeKind,
      })
    }

    const draftText = String(cfg.workflowJsonText || '').trim()
    if (!draftText) continue
    const selected = workflows.find((w) => w && w.id === cfg.selectedWorkflowId)
    const selectedJson = String(selected?.jsonText || '').trim()
    if (selectedJson === draftText) continue
    const draftId = `draft-${nodeKind}`
    const key = `${nodeKind}:${draftId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: draftId,
      name: String(cfg.workflowName || '').trim() || `当前编辑-${nodeKind}`,
      jsonText: draftText,
      nodeKind,
    })
  }

  return out
}

/**
 * @param {Buffer} buf
 */
function decodeChromiumLocalStorageValue(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return null
  if (buf[0] === 0x01 && buf[1] === 0x00) return buf.slice(2).toString('utf16le')
  if (buf[0] === 0x00) return buf.slice(1).toString('utf16le')
  return buf.toString('utf16le')
}

/**
 * @param {string} dbPath
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readWorkflowConfigFromLevelDb(dbPath) {
  const db = leveldown(dbPath)
  await new Promise((resolve, reject) => {
    db.open((err) => (err ? reject(err) : resolve(undefined)))
  })

  /** @type {Record<string, unknown> | null} */
  let config = null

  await new Promise((resolve, reject) => {
    const it = db.iterator()
    const step = () => {
      it.next((err, key, value) => {
        if (err) {
          it.end(() => reject(err))
          return
        }
        if (key === undefined) {
          it.end((endErr) => (endErr ? reject(endErr) : resolve(undefined)))
          return
        }
        const k = key.toString('binary')
        if (!k.includes(STORAGE_KEY)) {
          step()
          return
        }
        const decoded = decodeChromiumLocalStorageValue(Buffer.from(value))
        if (!decoded) {
          step()
          return
        }
        try {
          config = JSON.parse(decoded)
        } catch {
          // ignore
        }
        step()
      })
    }
    step()
  })

  await new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve(undefined)))
  })

  return config
}

function exportCloudFromRepo() {
  if (!fs.existsSync(CLOUD_JSON)) {
    console.warn('[云端] 未找到', CLOUD_JSON)
    return 0
  }
  const raw = JSON.parse(fs.readFileSync(CLOUD_JSON, 'utf8'))
  const list = Array.isArray(raw?.workflows) ? raw.workflows : []
  /** @type {Array<{ id: string; name: string; jsonText: string; nodeKind?: string }>} */
  const entries = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.id || '').trim()
    const name = String(item.name || '').trim()
    const jsonText = String(item.workflowJson || '').trim()
    if (!id || !jsonText) continue
    entries.push({
      id,
      name: name || id,
      jsonText,
      nodeKind: String(item.nodeKind || '').trim() || undefined,
    })
  }
  const n = writeEntriesToDisk(CLOUD_OUT_DIR, 'cloud', entries)
  console.log(`[云端] 已复制 ${n} 个 → ${CLOUD_OUT_DIR}`)
  return n
}

async function exportLocalFromLevelDb() {
  const dbPath =
    process.env.FLOWID_LEVELDB_PATH ||
    path.join(os.homedir(), 'AppData', 'Roaming', 'flowid', 'Local Storage', 'leveldb')

  if (!fs.existsSync(dbPath)) {
    console.warn('[本地] LevelDB 不存在，跳过:', dbPath)
    console.warn('       （仅复制了仓库内云端工作流；本地列表需在桌面版运行后由应用自动同步，或设置 FLOWID_LEVELDB_PATH）')
    return 0
  }

  let config
  try {
    config = await readWorkflowConfigFromLevelDb(dbPath)
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e)
    if (/LOCK|lock|EBUSY/i.test(msg)) {
      console.error('[本地] LevelDB 被占用：请先完全退出 Flowid，再运行本脚本。')
    } else {
      console.error('[本地] 读取失败:', msg)
    }
    return 0
  }

  if (!config) {
    console.warn('[本地] 未在 LevelDB 中找到', STORAGE_KEY)
    return 0
  }

  const entries = collectLocalEntriesFromConfig(config)
  const n = writeEntriesToDisk(LOCAL_OUT_DIR, 'local', entries)
  console.log(`[本地] 已复制 ${n} 个 → ${LOCAL_OUT_DIR}`)
  return n
}

async function main() {
  console.log('目标根目录:', BACKUP_ROOT)
  const cloudN = exportCloudFromRepo()
  const localN = await exportLocalFromLevelDb()
  console.log(`完成：云端 ${cloudN} 个，本地 ${localN} 个。`)
  if (cloudN === 0 && localN === 0) process.exit(1)
}

main()
