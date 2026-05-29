/**
 * Pull preset templates + 灵感小镇 (inspiration) + 云端 Comfy 工作流目录与 JSON from a running Auth server
 * into public/flowid-bundled/ for VITE_FLOWID_LOCAL_GALLERY=1 builds. Uses public HTTP routes only (no admin token).
 * 云端工作流随包后，运行时由 cloudWorkflowsApi 从 flowid-bundled/cloud-workflows/* 读取，避免每次请求香港等远端。
 *
 * Usage:
 *   npm run export:bundled-gallery
 *   FLOWID_EXPORT_GALLERY_BASE=https://your-auth:3721 npm run export:bundled-gallery
 *
 * Prerequisite: auth-server running (e.g. npm run auth:dev) and data populated in admin.
 *
 * 可选环境变量：
 * - FLOWID_EXPORT_FETCH_TIMEOUT_MS — 单次请求超时（默认 180000，约 3 分钟）
 * - FLOWID_EXPORT_FETCH_RETRIES — 失败重试次数含首次（默认 4）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundlePresetWorkflowJson } from './lib/preset-template-media-bundle.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OUT = path.join(REPO_ROOT, 'public', 'flowid-bundled')
const BASE = String(process.env.FLOWID_EXPORT_GALLERY_BASE || 'http://127.0.0.1:3721').replace(/\/+$/, '')

const CT_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const FALLBACK_SVG_DATA_URI =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect fill="#6366f1" width="160" height="100" rx="10"/></svg>',
  )

/** 单次 HTTP 超时（毫秒）；配合重试，避免单次过久卡住整段打包 */
const FETCH_TIMEOUT_MS = Number(process.env.FLOWID_EXPORT_FETCH_TIMEOUT_MS || 180000)
const FETCH_RETRIES = Math.max(1, Math.trunc(Number(process.env.FLOWID_EXPORT_FETCH_RETRIES || 4)))

function fetchTimeoutSignal() {
  try {
    return AbortSignal.timeout(FETCH_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetries(label, fn) {
  let last
  for (let i = 0; i < FETCH_RETRIES; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const msg = e instanceof Error ? e.message : String(e)
      // eslint-disable-next-line no-console
      console.warn(`[export-bundled-gallery] ${label} 第 ${i + 1}/${FETCH_RETRIES} 次失败: ${msg}`)
      if (i < FETCH_RETRIES - 1) await sleep(Math.min(12_000, 2000 * (i + 1)))
    }
  }
  throw last
}

async function fetchJson(url) {
  return withRetries(`GET ${url}`, async () => {
    let res
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: fetchTimeoutSignal(),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`无法请求 ${url}（请先启动 Auth，或设置 FLOWID_EXPORT_GALLERY_BASE）：${msg}`)
    }
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`GET ${url} -> ${res.status}: ${text.slice(0, 200)}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`GET ${url}: response is not JSON`)
    }
  })
}

async function writeJson(rel, obj) {
  const p = path.join(OUT, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8')
}

async function downloadCover(id) {
  const url = `${BASE}/inspiration-market/image/${encodeURIComponent(id)}`
  const res = await withRetries(`封面 ${id}`, async () => {
    const r = await fetch(url, { signal: fetchTimeoutSignal() })
    return r
  })
  if (!res.ok) {
    return { rel: null, imageUrl: FALLBACK_SVG_DATA_URI }
  }
  const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const ext = CT_EXT[ct] || '.bin'
  const buf = Buffer.from(await res.arrayBuffer())
  const rel = `inspiration/covers/${id}${ext}`
  const p = path.join(OUT, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, buf)
  return { rel, imageUrl: rel }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`[export-bundled-gallery] base=${BASE}`)
  // eslint-disable-next-line no-console
  console.log(`[export-bundled-gallery] out=${OUT}`)

  // eslint-disable-next-line no-console
  console.log('[export-bundled-gallery] GET /templates/groups ...')
  const groupsPayload = await fetchJson(`${BASE}/templates/groups`)
  await writeJson('preset-groups.json', groupsPayload)

  const ids = new Set()
  for (const g of Array.isArray(groupsPayload.groups) ? groupsPayload.groups : []) {
    for (const it of Array.isArray(g.items) ? g.items : []) {
      const id = String(it?.id || '').trim()
      if (id) ids.add(id)
    }
  }

  const wfDir = path.join(OUT, 'presets', 'workflows')
  await fs.mkdir(wfDir, { recursive: true })
  const idList = [...ids]
  for (let wi = 0; wi < idList.length; wi++) {
    const id = idList[wi]
    // eslint-disable-next-line no-console
    console.log(`[export-bundled-gallery] preset workflow ${wi + 1}/${idList.length}: ${id}`)
    const url = `${BASE}/templates/${encodeURIComponent(id)}/workflow`
    const text = await withRetries(`workflow ${id}`, async () => {
      const r = await fetch(url, { signal: fetchTimeoutSignal() })
      const t = await r.text()
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 120)}`)
      return t
    })
    const { json, stats } = await bundlePresetWorkflowJson(text, id, {
      repoRoot: REPO_ROOT,
      log: (msg) => console.log(`  [preset-media] ${msg}`),
    })
    if (stats.bundled > 0 || stats.skipped > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `  [preset-media] ${id}: 打包 ${stats.bundled}，复用 ${stats.reused}，跳过 ${stats.skipped}（blob 请放入 server/templates/preset-assets/<assetId>.*）`,
      )
    }
    await fs.writeFile(path.join(wfDir, `${id}.json`), json, 'utf8')
  }
  // eslint-disable-next-line no-console
  console.log(`[export-bundled-gallery] presets: ${ids.size} workflow file(s)`)

  // eslint-disable-next-line no-console
  console.log('[export-bundled-gallery] GET /cloud-workflows ...')
  const cwList = await fetchJson(`${BASE}/cloud-workflows`)
  const cwRows = Array.isArray(cwList.workflows) ? cwList.workflows : []
  await writeJson('cloud-workflows/catalog.json', {
    workflows: cwRows,
    serverTimeMs: Number(cwList.serverTimeMs) || Date.now(),
  })
  const cwWfDirRel = 'cloud-workflows/workflows'
  let cwExported = 0
  for (let ci = 0; ci < cwRows.length; ci += 1) {
    const row = cwRows[ci]
    const cid = String(row?.id || '').trim()
    if (!cid) continue
    cwExported += 1
    // eslint-disable-next-line no-console
    console.log(`[export-bundled-gallery] cloud-workflow ${ci + 1}/${cwRows.length}: ${cid}`)
    const detail = await fetchJson(`${BASE}/cloud-workflows/${encodeURIComponent(cid)}/workflow`)
    await writeJson(`${cwWfDirRel}/${cid}.json`, {
      id: String(detail.id || cid).trim(),
      name: String(detail.name || '').trim(),
      description: String(detail.description || '').trim(),
      nodeKind: String(detail.nodeKind || '').trim(),
      workflowJson: String(detail.workflowJson || '').trim(),
      serverTimeMs: Number(detail.serverTimeMs) || Date.now(),
    })
  }
  // eslint-disable-next-line no-console
  console.log(`[export-bundled-gallery] cloud-workflows: ${cwExported} workflow JSON file(s)`)

  // eslint-disable-next-line no-console
  console.log('[export-bundled-gallery] GET /inspiration-market/meta ...')
  const meta = await fetchJson(`${BASE}/inspiration-market/meta`)
  await writeJson(
    'inspiration/meta.json',
    {
      categories: Array.isArray(meta.categories) ? meta.categories : [],
      serverTimeMs: Number(meta.serverTimeMs) || Date.now(),
    },
  )

  // eslint-disable-next-line no-console
  console.log('[export-bundled-gallery] GET /inspiration-market/list ...')
  const listPayload = await fetchJson(`${BASE}/inspiration-market/list`)
  const rawItems = Array.isArray(listPayload.items) ? listPayload.items : []
  const itemsDir = path.join(OUT, 'inspiration', 'items')
  await fs.mkdir(itemsDir, { recursive: true })

  const listItems = []
  let inspDone = 0
  const inspTotal = rawItems.filter((row) => String(row?.id || '').trim()).length
  // eslint-disable-next-line no-console
  console.log(`[export-bundled-gallery] inspiration rows to fetch: ${inspTotal} (each = item + cover, may take several minutes)`)

  for (const row of rawItems) {
    const id = String(row?.id || '').trim()
    if (!id) continue
    inspDone += 1
    // eslint-disable-next-line no-console
    console.log(`[export-bundled-gallery] inspiration ${inspDone}/${inspTotal}: ${id}`)
    const detail = await fetchJson(`${BASE}/inspiration-market/item/${encodeURIComponent(id)}`)
    const { imageUrl } = await downloadCover(id)

    const listRow = {
      id: detail.id,
      title: detail.title,
      description: String(detail.description || ''),
      category: String(detail.category || ''),
      imageUrl,
    }
    listItems.push(listRow)

    const itemDoc = {
      id: detail.id,
      title: detail.title,
      description: String(detail.description || ''),
      category: String(detail.category || ''),
      imageUrl,
      promptText: String(detail.promptText || ''),
    }
    await writeJson(`inspiration/items/${id}.json`, itemDoc)
  }

  await writeJson('inspiration/list.json', {
    items: listItems,
    serverTimeMs: Number(listPayload.serverTimeMs) || Date.now(),
  })

  // eslint-disable-next-line no-console
  console.log(`[export-bundled-gallery] inspiration: ${listItems.length} item(s)`)
  // eslint-disable-next-line no-console
  console.log('[export-bundled-gallery] done')
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[export-bundled-gallery]', e.message || e)
  process.exit(1)
})
