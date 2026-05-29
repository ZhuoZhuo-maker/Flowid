/**
 * 将 Wan SVI 强动感工作流写入 Flowid 本地设置（localStorage leveldb）与工作流目录。
 * 使用前请完全退出 Flowid 桌面端，否则会因 LevelDB LOCK 失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import leveldown from 'leveldown'

const STORAGE_KEY = 'flowid.workflow.config.v1'
/** 可选：将 Wan SVI API JSON 放在任意路径，通过环境变量 FLOWID_SVI_WORKFLOW_SOURCE 指定 */
const SOURCE = path.resolve(
  process.env.FLOWID_SVI_WORKFLOW_SOURCE ||
    'workflows/import-ready/Wan2.2_SVI_长段_强动感.flowid.api.json',
)
const WORKFLOW_NAMES = [
  'Wan2.2_SVI_长段_强动感.flowid.api',
  'Wan2.2_SVI_长视频生成_加速稿.flowid.api',
  'Wan2.2_SVI_长视频生成_加速稿',
  'Wan2.2_SVI_长段_强动感',
]

/** @param {string} jsonText */
function isWanSviWorkflow(jsonText) {
  return /WanImageToVideoSVIPro/i.test(jsonText)
}

/** @param {string} dir */
function copyToWorkflowDir(dir) {
  const text = fs.readFileSync(SOURCE, 'utf8')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  for (const name of WORKFLOW_NAMES) {
    const fp = path.join(dir, `${name}.json`)
    fs.writeFileSync(fp, text, 'utf8')
    console.log('[写入工作流目录]', fp)
  }
}

/**
 * Chromium Local Storage 值解码（Electron 常见为 0x00 + UTF-16LE JSON）。
 * @param {Buffer} buf
 */
function decodeChromiumLocalStorageValue(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return null
  if (buf[0] === 0x01 && buf[1] === 0x00) {
    return buf.slice(2).toString('utf16le')
  }
  if (buf[0] === 0x00) {
    return buf.slice(1).toString('utf16le')
  }
  return buf.toString('utf16le')
}

/**
 * Chromium Local Storage 值编码（与读取格式一致）。
 * @param {string} text
 */
function encodeChromiumLocalStorageValue(text) {
  const body = Buffer.from(String(text), 'utf16le')
  return Buffer.concat([Buffer.from([0x00]), body])
}

/**
 * @param {import('leveldown').LevelDOWN} db
 * @returns {Promise<Map<string, string>>}
 */
function readStorageEntries(db) {
  return new Promise((resolve, reject) => {
    /** @type {Map<string, string>} */
    const entries = new Map()
    const it = db.iterator()
    const step = () => {
      it.next((err, key, value) => {
        if (err) {
          it.end(() => reject(err))
          return
        }
        if (key === undefined) {
          it.end((endErr) => (endErr ? reject(endErr) : resolve(entries)))
          return
        }
        const k = key.toString('binary')
        if (k.includes(STORAGE_KEY)) {
          const decoded = decodeChromiumLocalStorageValue(Buffer.from(value))
          if (decoded) entries.set(k, decoded)
        }
        step()
      })
    }
    step()
  })
}

/** @param {string} dbPath */
async function patchLevelDb(dbPath) {
  const db = leveldown(dbPath)
  await new Promise((resolve, reject) => {
    db.open((err) => (err ? reject(err) : resolve(undefined)))
  })

  const entries = await readStorageEntries(db)
  if (!entries.size) {
    await new Promise((resolve, reject) => {
      db.close((err) => (err ? reject(err) : resolve(undefined)))
    })
    throw new Error(`未在 LevelDB 中找到 ${STORAGE_KEY}`)
  }

  const newJsonText = fs.readFileSync(SOURCE, 'utf8')
  let patched = 0

  for (const [storageKey, raw] of entries) {
    /** @type {Record<string, unknown>} */
    let config
    try {
      config = JSON.parse(raw)
    } catch {
      console.warn('[跳过] 无法解析配置')
      continue
    }
    const video = config?.nodeConfigs?.video
    if (!video || typeof video !== 'object') continue

    let changed = false
    const workflows = Array.isArray(video.workflows) ? video.workflows : []
    for (const item of workflows) {
      if (!item || typeof item !== 'object') continue
      const jt = String(item.jsonText || '')
      if (!isWanSviWorkflow(jt) && !/Wan2\.2_SVI|SVI_长/.test(String(item.name || ''))) continue
      item.jsonText = newJsonText
      item.name = 'Wan2.2_SVI_长段_强动感.flowid.api'
      video.selectedWorkflowId = item.id
      changed = true
      patched++
      console.log('[更新工作流列表项]', item.id || item.name)
    }

    const activeText = String(video.workflowJsonText || '')
    if (isWanSviWorkflow(activeText) || /Wan2\.2_SVI|SVI_长/.test(String(video.workflowName || ''))) {
      video.workflowJsonText = newJsonText
      video.workflowName = 'Wan2.2_SVI_长段_强动感.flowid.api'
      changed = true
    }

    if (video.cloudWorkflowOverrides && typeof video.cloudWorkflowOverrides === 'object') {
      for (const [id, ov] of Object.entries(video.cloudWorkflowOverrides)) {
        const jt =
          typeof ov === 'string' ? ov : String((/** @type {{jsonText?: string}} */ (ov)).jsonText || '')
        if (!isWanSviWorkflow(jt)) continue
        if (typeof ov === 'string') {
          video.cloudWorkflowOverrides[id] = newJsonText
        } else {
          /** @type {{jsonText?: string}} */ (ov).jsonText = newJsonText
        }
        changed = true
        patched++
        console.log('[更新云端覆盖]', id)
      }
    }

    if (!changed) continue
    await new Promise((resolve, reject) => {
      db.put(storageKey, encodeChromiumLocalStorageValue(JSON.stringify(config)), (err) =>
        err ? reject(err) : resolve(undefined),
      )
    })
    console.log('[已写入 localStorage]', storageKey.replace(/\0/g, '\\0').slice(0, 80))
  }

  await new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve(undefined)))
  })
  return patched
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('源工作流不存在:', SOURCE)
    process.exit(1)
  }
  const meta = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
  const w = meta['791']?.inputs?.width
  const h = meta['791']?.inputs?.height
  console.log('[源 Scale]', w, 'x', h, w === 896 && h === 512 ? '(固定横屏 OK)' : '(请检查)')

  copyToWorkflowDir(path.join('d:', 'flowid-zy', 'workflow'))
  const dl = path.join('d:', '网页下载内容')
  if (!fs.existsSync(dl)) fs.mkdirSync(dl, { recursive: true })
  fs.copyFileSync(SOURCE, path.join(dl, 'Wan2.2_SVI_长段_强动感.flowid.api.json'))
  console.log('[复制]', path.join(dl, 'Wan2.2_SVI_长段_强动感.flowid.api.json'))

  const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'flowid', 'Local Storage', 'leveldb')
  if (!fs.existsSync(dbPath)) {
    console.warn('[跳过 LevelDB] 路径不存在')
    return
  }

  try {
    const n = await patchLevelDb(dbPath)
    if (n === 0) {
      console.warn('LevelDB 中未匹配到 Wan SVI 条目；磁盘 JSON 已更新，可在设置里手动选该文件导入。')
    } else {
      console.log(`完成：共更新 ${n} 处 Wan SVI 配置。请重新打开 Flowid。`)
    }
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e)
    if (/LOCK|lock|EBUSY|正在使用/i.test(msg)) {
      console.error('LevelDB 被占用：请先完全退出 Flowid / Electron，再运行本脚本。')
    } else {
      console.error(msg)
    }
    process.exit(1)
  }
}

main()
