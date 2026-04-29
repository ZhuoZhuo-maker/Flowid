#!/usr/bin/env node
/**
 * 将 YouMind GPT Image 2 提示词库按「分类」导出为多个 Markdown 文件。
 *
 * 说明：网页 https://youmind.com/zh-CN/gpt-image-2-prompts 为前端渲染，且 `?categories=xxx`
 * 与 YouMind 开源的 references 使用同一套 slug。官方数据每日同步至：
 *   https://github.com/YouMind-OpenLab/ai-image-prompts-skill/tree/main/references
 * 本脚本从该仓库拉取 manifest + 各分类 JSON（无需登录、无需浏览器），生成与网站分类一一对应的 md。
 *
 * 用法：
 *   node scripts/export-youmind-gpt-image-prompts.mjs
 *   node scripts/export-youmind-gpt-image-prompts.mjs --out ./exports/youmind-prompts
 *   node scripts/export-youmind-gpt-image-prompts.mjs --only app-web-design,poster-flyer
 *   node scripts/export-youmind-gpt-image-prompts.mjs --max 50
 *
 * 若必须抓取中文页展示标题，需自行用 Playwright 等对接动态 DOM（易随改版失效），不推荐作默认路径。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const GALLERY_ZH = 'https://youmind.com/zh-CN/gpt-image-2-prompts'

/** 多个根地址：GitHub raw 在部分网络下会 ECONNRESET，可自动换 jsDelivr。也可设环境变量优先用自己的镜像。 */
function getReferenceBaseUrls() {
  const env = String(process.env.YOUMIND_REFERENCES_BASE || '')
    .trim()
    .replace(/\/+$/, '')
  const defaults = [
    'https://raw.githubusercontent.com/YouMind-OpenLab/ai-image-prompts-skill/main/references',
    'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/ai-image-prompts-skill@main/references',
  ]
  const out = []
  if (env) out.push(env)
  for (const d of defaults) {
    const u = d.replace(/\/+$/, '')
    if (u && !out.includes(u)) out.push(u)
  }
  return out.map((u) => `${u}/`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isRetryableFetchError(err) {
  const cause = err?.cause
  const code = String(cause?.code || err?.code || '')
  const msg = String(err?.message || cause?.message || '')
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_SOCKET' ||
    msg.includes('fetch failed') ||
    msg.includes('ECONNRESET')
  )
}

/**
 * @param {string} url
 * @param {{ retries?: number; progressLabel?: string; quiet?: boolean }} [options]
 */
async function fetchJson(url, options = {}) {
  const retries = options.retries ?? 5
  const quiet = Boolean(options.quiet)
  const progressLabel = String(options.progressLabel || '').trim()
  const headers = { 'User-Agent': 'flowid-export-youmind-prompts/1.1' }
  let lastErr
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
      if (progressLabel && !quiet) {
        process.stderr.write(`  ${progressLabel}：HTTP ${res.status}，正在读入响应体…\n`)
        const buf = await readResponseBodyWithProgress(res, progressLabel, quiet)
        process.stderr.write(`  ${progressLabel}：正在解析 JSON…\n`)
        const parsed = JSON.parse(buf.toString('utf8'))
        const n = Array.isArray(parsed) ? parsed.length : 0
        process.stderr.write(`  ${progressLabel}：解析完成（${n} 条）\n`)
        return parsed
      }
      return await res.json()
    } catch (e) {
      lastErr = e
      const canRetry = attempt < retries - 1 && isRetryableFetchError(e)
      if (canRetry) {
        const ms = Math.min(16_000, 1000 * 2 ** attempt)
        process.stderr.write(
          `[retry] ${attempt + 1}/${retries - 1} in ${ms}ms (${String((e?.cause && e.cause.code) || e?.message).slice(0, 80)})\n`,
        )
        await sleep(ms)
        continue
      }
      throw e
    }
  }
  throw lastErr
}

/** 依次尝试各 base，直到 manifest 拉取成功 */
async function pickWorkingBase() {
  const bases = getReferenceBaseUrls()
  let lastErr
  for (const base of bases) {
    const url = `${base}manifest.json`
    try {
      process.stderr.write(`Trying ${url}\n`)
      const manifest = await fetchJson(url)
      return { base, manifestUrl: url, manifest }
    } catch (e) {
      lastErr = e
      process.stderr.write(`  failed: ${(e && e.message) || e}\n`)
    }
  }
  throw new Error(
    `无法拉取 manifest（已尝试 ${bases.length} 个源）。可设置环境变量 YOUMIND_REFERENCES_BASE 指向可访问的 references 根 URL（以 / 结尾）。最后错误: ${lastErr?.message || lastErr}`,
  )
}

function parseArgs(argv) {
  const out = {
    dir: path.join(__dirname, '..', 'exports', 'youmind-gpt-image-2-prompts'),
    only: null,
    max: Infinity,
    quiet: false,
  }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--quiet' || a === '-q') {
      out.quiet = true
      continue
    }
    if (a === '--out' && argv[i + 1]) {
      out.dir = path.resolve(argv[i + 1])
      i += 1
    } else if (a.startsWith('--out=')) {
      out.dir = path.resolve(a.slice('--out='.length))
    } else if (a === '--only' && argv[i + 1]) {
      out.only = new Set(
        argv[i + 1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      i += 1
    } else if (a.startsWith('--only=')) {
      out.only = new Set(
        a
          .slice('--only='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    } else if (a === '--max' && argv[i + 1]) {
      out.max = Math.max(1, Number(argv[i + 1]) || 1)
      i += 1
    } else if (a.startsWith('--max=')) {
      out.max = Math.max(1, Number(a.slice('--max='.length)) || 1)
    }
  }
  return out
}

/**
 * 流式读响应体并打印下载进度（大 JSON 如 product-marketing.json 约 10MB+，否则长时间无输出）。
 */
async function readResponseBodyWithProgress(res, label, quiet) {
  if (quiet || !res.body) {
    return Buffer.from(await res.arrayBuffer())
  }
  const total = Number(res.headers.get('content-length') || '') || 0
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  let lastReport = 0
  const step = 512 * 1024
  const tty = process.stderr.isTTY
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value && value.length) {
      chunks.push(Buffer.from(value))
      received += value.length
      if (received - lastReport >= step || (total > 0 && received >= total)) {
        if (total > 0) {
          const pct = Math.min(100, (received / total) * 100).toFixed(1)
          const line = `${label} 下载 ${pct}% (${(received / 1e6).toFixed(2)} / ${(total / 1e6).toFixed(2)} MB)`
          if (tty) process.stderr.write(`\r  ${line}   `)
          else process.stderr.write(`  ${line}\n`)
        } else {
          const line = `${label} 已下载 ${(received / 1e6).toFixed(2)} MB（总大小未知）`
          if (tty) process.stderr.write(`\r  ${line}   `)
          else process.stderr.write(`  ${line}\n`)
        }
        lastReport = received
      }
    }
  }
  if (!quiet && received > 0) {
    if (lastReport === 0) {
      const line =
        total > 0
          ? `${label} 下载 100% (${(received / 1e6).toFixed(2)} / ${(total / 1e6).toFixed(2)} MB)`
          : `${label} 读入 ${(received / 1e6).toFixed(2)} MB`
      if (tty) process.stderr.write(`\r  ${line}\n`)
      else process.stderr.write(`  ${line}\n`)
    } else if (tty) {
      process.stderr.write('\n')
    }
  }
  return Buffer.concat(chunks)
}

/** 选用不与正文冲突的 fenced code 围栏 */
function fencedCode(lang, body) {
  const raw = String(body ?? '')
  let fence = '```'
  while (raw.includes(fence)) fence += '`'
  return `${fence}${lang ? lang : ''}\n${raw}\n${fence}`
}

function safeFileSlug(slug) {
  return String(slug || 'unknown')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'category'
}

function escapeMdAlt(text) {
  return String(text || '').replace(/\]/g, '\\]')
}

function printHelp() {
  console.log(`用法: node scripts/export-youmind-gpt-image-prompts.mjs [选项]

从 YouMind 官方开源 references 导出与 https://youmind.com/zh-CN/gpt-image-2-prompts
同目录结构的提示词（每分类一个 md 文件，文件名 = slug）。

选项:
  --out <目录>     输出目录（默认: FLOWID/exports/youmind-gpt-image-2-prompts）
  --only a,b      只导出指定 slug，逗号分隔
  --max N         每分类最多导出 N 条（调试用）
  --quiet, -q     不打印下载字节进度（适合重定向日志）

数据源: YouMind-OpenLab/ai-image-prompts-skill/references（与画廊 categories 一致）

网络: 若 GitHub raw 报 ECONNRESET，脚本会自动重试并改用 jsDelivr。
也可设置环境变量 YOUMIND_REFERENCES_BASE（可访问的 references 根路径，例如镜像）。
`)
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp()
    return
  }
  const opts = parseArgs(process.argv)
  await fs.mkdir(opts.dir, { recursive: true })

  const { base: jsonBase, manifestUrl, manifest } = await pickWorkingBase()
  const categories = Array.isArray(manifest.categories) ? manifest.categories : []
  if (!categories.length) {
    console.error('manifest 中无 categories')
    process.exit(1)
  }

  const indexLines = [
    '# YouMind GPT Image 2 提示词导出索引',
    '',
    `- 导出时间（UTC）：${new Date().toISOString()}`,
    `- 本次使用的数据根：${jsonBase}`,
    `- manifest：${manifestUrl}`,
    `- 画廊（中文）：${GALLERY_ZH}`,
    '',
    '提示词由 [YouMind.com](https://youmind.com) 通过公开社区搜集。',
    '',
    '## 分类文件',
    '',
    '| slug | 标题 | 条目数 | 文件 |',
    '|------|------|--------|------|',
  ]

  for (const cat of categories) {
    const slug = String(cat.slug || '').trim()
    const title = String(cat.title || slug).trim()
    const file = String(cat.file || `${slug}.json`).trim()
    if (!slug || !file) continue
    if (opts.only && !opts.only.has(slug)) continue

    const url = `${jsonBase}${file}`
    process.stderr.write(`Fetching ${slug} (${file})…\n`)
    const list = await fetchJson(url, { progressLabel: slug, quiet: opts.quiet })
    if (!Array.isArray(list)) {
      console.warn(`跳过 ${slug}：JSON 不是数组`)
      continue
    }

    const slice = Number.isFinite(opts.max) ? list.slice(0, opts.max) : list
    const mdName = `${safeFileSlug(slug)}.md`
    const mdPath = path.join(opts.dir, mdName)

    const parts = []
    parts.push(`# ${title}`)
    parts.push('')
    parts.push(`- **分类 slug**：\`${slug}\`（网页参数 \`?categories=${slug}\`）`)
    parts.push(`- **条目数**：${list.length}${opts.max < list.length ? `（本文件仅导出前 ${opts.max} 条，可用 --max 调整）` : ''}`)
    parts.push(`- **数据**：[\`${file}\`](${url})`)
    parts.push(`- **画廊**：${GALLERY_ZH}?categories=${encodeURIComponent(slug)}`)
    if (manifest.updatedAt) parts.push(`- **manifest.updatedAt**：${manifest.updatedAt}`)
    parts.push('')
    parts.push('---')
    parts.push('')

    const mdProgressEvery = slice.length >= 2000 ? 500 : slice.length >= 800 ? 200 : 0
    for (let i = 0; i < slice.length; i += 1) {
      if (mdProgressEvery && !opts.quiet && i > 0 && i % mdProgressEvery === 0) {
        const tty = process.stderr.isTTY
        const line = `${slug} 写入 MD：${i} / ${slice.length}`
        if (tty) process.stderr.write(`\r  ${line}   `)
        else process.stderr.write(`  ${line}\n`)
      }
      const row = slice[i] || {}
      const id = row.id != null ? String(row.id) : String(i + 1)
      const rowTitle = String(row.title || `条目 ${i + 1}`).trim()
      const desc = String(row.description || '').trim()
      const content = String(row.content || '').trim()
      const needRef = Boolean(row.needReferenceImages)
      const media = Array.isArray(row.sourceMedia) ? row.sourceMedia.filter(Boolean) : []

      parts.push(`## ${i + 1}. ${rowTitle}`)
      parts.push('')
      parts.push(`- **id**：${id}`)
      if (needRef) parts.push('- **需要参考图**：是')
      parts.push(`- **画廊链接**：${GALLERY_ZH}?id=${encodeURIComponent(id)}`)
      parts.push('')
      if (desc) {
        parts.push('### 描述')
        parts.push('')
        parts.push(desc)
        parts.push('')
      }
      if (media.length) {
        parts.push('### 示例图')
        parts.push('')
        for (const src of media) {
          const u = String(src).trim()
          if (!u) continue
          parts.push(`![${escapeMdAlt(rowTitle)}](${u})`)
          parts.push('')
        }
      }
      if (content) {
        parts.push('### 提示词')
        parts.push('')
        parts.push(fencedCode('', content))
        parts.push('')
      }
      parts.push('---')
      parts.push('')
    }

    if (mdProgressEvery && !opts.quiet && process.stderr.isTTY && slice.length > mdProgressEvery) {
      process.stderr.write('\n')
    }
    await fs.writeFile(mdPath, parts.join('\n'), 'utf8')
    process.stderr.write(`Wrote ${mdPath} (${slice.length} prompts)\n`)

    indexLines.push(
      `| ${slug} | ${title.replace(/\|/g, '\\|')} | ${list.length} | [\`${mdName}\`](./${mdName}) |`,
    )
  }

  indexLines.push('')
  await fs.writeFile(path.join(opts.dir, 'README.md'), indexLines.join('\n'), 'utf8')
  process.stderr.write(`Done. Index: ${path.join(opts.dir, 'README.md')}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
