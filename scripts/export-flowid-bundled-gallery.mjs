/**
 * Pull preset templates + 灵感小镇 (inspiration) data from a running Auth server into public/flowid-bundled/
 * for VITE_FLOWID_LOCAL_GALLERY=1 builds. Uses public HTTP routes only (no admin token).
 *
 * Usage:
 *   npm run export:bundled-gallery
 *   FLOWID_EXPORT_GALLERY_BASE=https://your-auth:3721 npm run export:bundled-gallery
 *
 * Prerequisite: auth-server running (e.g. npm run auth:dev) and data populated in admin.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function fetchJson(url) {
  let res
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`无法请求 ${url}（请先启动 Auth，或设置 FLOWID_EXPORT_GALLERY_BASE 指向可访问的根地址）：${msg}`)
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
}

async function writeJson(rel, obj) {
  const p = path.join(OUT, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8')
}

async function downloadCover(id) {
  const url = `${BASE}/inspiration-market/image/${encodeURIComponent(id)}`
  let res
  try {
    res = await fetch(url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`封面 ${id}: ${msg}`)
  }
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
  for (const id of ids) {
    const url = `${BASE}/templates/${encodeURIComponent(id)}/workflow`
    let res
    try {
      res = await fetch(url)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`workflow ${id}: ${msg}`)
    }
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`workflow ${id}: HTTP ${res.status} ${text.slice(0, 120)}`)
    }
    await fs.writeFile(path.join(wfDir, `${id}.json`), text, 'utf8')
  }
  // eslint-disable-next-line no-console
  console.log(`[export-bundled-gallery] presets: ${ids.size} workflow file(s)`)

  const meta = await fetchJson(`${BASE}/inspiration-market/meta`)
  await writeJson(
    'inspiration/meta.json',
    {
      categories: Array.isArray(meta.categories) ? meta.categories : [],
      serverTimeMs: Number(meta.serverTimeMs) || Date.now(),
    },
  )

  const listPayload = await fetchJson(`${BASE}/inspiration-market/list`)
  const rawItems = Array.isArray(listPayload.items) ? listPayload.items : []
  const itemsDir = path.join(OUT, 'inspiration', 'items')
  await fs.mkdir(itemsDir, { recursive: true })

  const listItems = []
  for (const row of rawItems) {
    const id = String(row?.id || '').trim()
    if (!id) continue
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
