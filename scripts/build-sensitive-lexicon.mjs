/**
 * 从 MIT 开源库 konsheng/Sensitive-lexicon 拉取若干词表，合并去重后生成
 * `src/data/sensitiveLexiconOpenSource.generated.ts`
 *
 * 含：政治类型、反动词库（人名等，产品要求需拦截）。排除：广告类型、超大文件（网易/腾讯/GFW/非法网址等）。
 *
 * 用法: node scripts/build-sensitive-lexicon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'src', 'data', 'sensitiveLexiconOpenSource.generated.ts')

const BASE =
  'https://raw.githubusercontent.com/konsheng/Sensitive-lexicon/main/Vocabulary/'

/** path segment 已是 URL 编码的文件名（政治类放前，避免 MAX_TOTAL 被其它表占满后人名进不来） */
const SOURCES = [
  { path: '%E6%94%BF%E6%B2%BB%E7%B1%BB%E5%9E%8B.txt', level: 'block', category: 'political' },
  { path: '%E5%8F%8D%E5%8A%A8%E8%AF%8D%E5%BA%93.txt', level: 'block', category: 'political' },
  { path: '%E6%9A%B4%E6%81%90%E8%AF%8D%E5%BA%93.txt', level: 'block', category: 'violence' },
  { path: '%E8%89%B2%E6%83%85%E8%AF%8D%E5%BA%93.txt', level: 'block', category: 'porn' },
  { path: '%E8%89%B2%E6%83%85%E7%B1%BB%E5%9E%8B.txt', level: 'block', category: 'porn' },
  { path: '%E6%B6%89%E6%9E%AA%E6%B6%89%E7%88%86.txt', level: 'block', category: 'violence' },
  { path: '%E8%B4%AA%E8%85%90%E8%AF%8D%E5%BA%93.txt', level: 'block', category: 'illegal' },
  // 以下两表体量极大、长尾误伤多，且会拖慢 AC 构建；若需更严可取消注释后重新 gen:sensitive-lexicon
  // { path: '%E5%85%B6%E4%BB%96%E8%AF%8D%E5%BA%93.txt', level: 'block', category: 'other' },
  // { path: '%E8%A1%A5%E5%85%85%E8%AF%8D%E5%BA%93.txt', level: 'block', category: 'illegal' },
]

/** 开源拉取上限（与 build:lexicon 阶段 FLOWID_LEXICON_MAX 二选一配合，先减源再裁剪） */
const MAX_TOTAL = 6000
const MIN_LEN = 2
const MAX_LEN = 28

function okLine(w) {
  if (w.length < MIN_LEN || w.length > MAX_LEN) return false
  if (/https?:|www\.|\.com|\.cn|\.net|\.org/i.test(w)) return false
  if (/^\s*$/.test(w)) return false
  // 纯英文长串多为药名/技术词，在中文创作场景误伤高
  if (/^[a-zA-Z]+$/.test(w) && w.length > 8) return false
  return true
}

function escStr(s) {
  return JSON.stringify(s)
}

async function main() {
  const byWord = new Map()

  for (const src of SOURCES) {
    const url = BASE + src.path
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
    const text = await res.text()
    for (const line of text.split(/\r?\n/)) {
      const w = line.trim()
      if (!okLine(w)) continue
      if (byWord.size >= MAX_TOTAL) break
      const key = w.toLowerCase()
      if (byWord.has(key)) continue
      byWord.set(key, { word: w, level: src.level, category: src.category })
    }
    if (byWord.size >= MAX_TOTAL) break
  }

  const list = [...byWord.values()].sort((a, b) => b.word.length - a.word.length)
  const lines = [
    '/**',
    ' * AUTO-GENERATED — 勿手改。重新生成：`npm run gen:sensitive-lexicon`',
    ' * 来源：MIT https://github.com/konsheng/Sensitive-lexicon（含政治/反动子表，见 scripts/build-sensitive-lexicon.mjs）',
    ' */',
    '',
    "export type OpenSourceSensitiveLevel = 'warning' | 'block'",
    "export type OpenSourceSensitiveCategory = 'political' | 'porn' | 'violence' | 'illegal' | 'ad' | 'other'",
    '',
    'export type OpenSourceSensitiveWord = {',
    '  word: string',
    '  level: OpenSourceSensitiveLevel',
    '  category: OpenSourceSensitiveCategory',
    '}',
    '',
    `export const openSourceSensitiveWords: OpenSourceSensitiveWord[] = [`,
  ]

  for (const item of list) {
    lines.push(
      `  { word: ${escStr(item.word)}, level: '${item.level}', category: '${item.category}' },`,
    )
  }
  lines.push(']', '')
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log('Wrote', OUT, 'entries:', list.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
