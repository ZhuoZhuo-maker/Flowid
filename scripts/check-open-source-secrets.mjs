/**
 * 开源前扫描：禁止 nowcoding.ai、常见 sk- Key、节点内嵌 cloudApiKey 等进入发布目录。
 * 用法：npm run check:open-source-secrets
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 相对仓库根目录，参与扫描（不含 flowid-bundled，见下方单独告警） */
const SCAN_ROOTS = [
  'server',
  'src',
  'scripts',
  'electron',
  '.env.example',
  'README.md',
  'package.json',
]

/** 文档中允许出现 nowcoding 字样说明，不参与匹配 */
const SCAN_DOC_ALLOWLIST = new Set(['docs/open-source-security-checklist.md'])

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'release',
  'deliverables',
  'release-analyzer',
  '.git',
])

const RULES = [
  {
    id: 'nowcoding',
    pattern: /nowcoding\.ai/i,
    hint: '移除 nowcoding.ai，改用自建网关或留空 cloud-assist-models.json',
  },
  {
    id: 'openai-sk',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
    hint: '疑似 OpenAI 兼容 API Key，请从模板/配置中删除并轮换已泄露 Key',
  },
  {
    id: 'node-embedded-key',
    pattern: /"cloudApiKey"\s*:\s*"(?!")[^"]{8,}"/,
    hint: 'workflow 节点内嵌 cloudApiKey，请运行 npm run sanitize:cloud-secrets',
  },
  {
    id: 'assist-nowcoding-pick',
    pattern: /flowid-assist:[^\s"]+nowcoding/i,
    hint: 'flowid-assist 绑定含 nowcoding，请清空 cloudAssistModelPick',
  },
]

/** @param {string} filePath */
function shouldScanFile(filePath) {
  const rel = path.relative(root, filePath).replace(/\\/g, '/')
  if (rel.includes('check-open-source-secrets')) return false
  if (rel.includes('sanitize-repo-cloud-credentials')) return false
  if (rel.endsWith('.example.json')) return false
  if (rel.endsWith('.png') || rel.endsWith('.jpg') || rel.endsWith('.webp')) return false
  if (rel.endsWith('.mp3') || rel.endsWith('.mp4') || rel.endsWith('.webm')) return false
  return (
    rel.endsWith('.json') ||
    rel.endsWith('.ts') ||
    rel.endsWith('.tsx') ||
    rel.endsWith('.js') ||
    rel.endsWith('.mjs') ||
    rel.endsWith('.cjs') ||
    rel.endsWith('.md') ||
    rel.endsWith('.bat') ||
    rel.endsWith('.example') ||
    rel === '.env.example' ||
    rel === 'README.md' ||
    rel === 'package.json'
  )
}

/** @param {string} dir */
function walk(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(name)) continue
      walk(full, out)
    } else if (st.isFile()) {
      out.push(full)
    }
  }
}

function collectFiles() {
  /** @type {string[]} */
  const files = []
  for (const rel of SCAN_ROOTS) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    const st = fs.statSync(abs)
    if (st.isFile()) files.push(abs)
    else walk(abs, files)
  }
  return [...new Set(files)].filter(shouldScanFile)
}

/** @param {string} dirRel */
function scanTreeIfPresent(dirRel) {
  const abs = path.join(root, dirRel)
  if (!fs.existsSync(abs)) return []
  /** @type {string[]} */
  const files = []
  walk(abs, files)
  return files.filter(shouldScanFile)
}

function main() {
  const files = collectFiles()
  for (const rel of ['docs']) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    walk(abs, files)
  }
  const bundledFiles = scanTreeIfPresent('public/flowid-bundled')
  const allFiles = [...new Set([...files.filter((f) => {
    const rel = path.relative(root, f).replace(/\\/g, '/')
    return !SCAN_DOC_ALLOWLIST.has(rel)
  }), ...bundledFiles])]

  /** @type {{ file: string, line: number, rule: string, hint: string, snippet: string }[]} */
  const hits = []

  for (const file of allFiles) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue
        hits.push({
          file: path.relative(root, file).replace(/\\/g, '/'),
          line: i + 1,
          rule: rule.id,
          hint: rule.hint,
          snippet: line.trim().slice(0, 120),
        })
      }
    }
  }

  const bundledDir = path.join(root, 'public/flowid-bundled')
  const bundledHits = hits.filter((h) => h.file.startsWith('public/flowid-bundled/'))
  const repoHits = hits.filter((h) => !h.file.startsWith('public/flowid-bundled/'))

  if (!repoHits.length && !bundledHits.length) {
    if (fs.existsSync(bundledDir)) {
      console.log(
        '[check:open-source-secrets] 通过（仓库可发布）。注意：本机仍有 public/flowid-bundled/，打包前请先 sanitize 或删除该目录。',
      )
    } else {
      console.log('[check:open-source-secrets] 通过：未发现 nowcoding / sk- / 节点内嵌 Key 等模式。')
    }
    process.exit(0)
  }

  if (!repoHits.length && bundledHits.length) {
    console.error(
      '[check:open-source-secrets] 仓库内已干净，但本机 public/flowid-bundled/ 仍含敏感内容（不会进 Git，但打包会带入）。\n',
    )
    console.error('  请执行：npm run sanitize:cloud-secrets  或删除 public/flowid-bundled/\n')
    for (const h of bundledHits.slice(0, 8)) {
      console.error(`  ${h.file}:${h.line} [${h.rule}]`)
    }
    if (bundledHits.length > 8) console.error(`  … 另有 ${bundledHits.length - 8} 处`)
    process.exit(1)
  }

  hits.length = 0
  hits.push(...repoHits)

  console.error('[check:open-source-secrets] 发现可疑内容，请勿开源直至修复：\n')
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line} [${h.rule}]`)
    console.error(`    ${h.snippet}`)
    console.error(`    → ${h.hint}\n`)
  }
  console.error(`共 ${hits.length} 处。可先执行：npm run sanitize:cloud-secrets`)
  process.exit(1)
}

main()
