/**
 * 合并 `sensitiveCore` + `sensitiveLexiconOpenSource.generated` → `public/lexicon/sensitive.json`
 * 运行：`npm run build:lexicon`（内部用 tsx 执行本文件）
 *
 * 词表过大时主线程构建 AC 耗时会明显变长；可通过环境变量限制合并后条数（超出部分按类别优先级丢弃）：
 *   cross-env FLOWID_LEXICON_MAX=2500 npm run build:lexicon
 * 默认 2800；设为 0 表示不裁剪。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SENSITIVE_CORE } from '../src/data/sensitiveCore'
import { openSourceSensitiveWords } from '../src/data/sensitiveLexiconOpenSource.generated'
import { wordsToJsonEntries } from '../src/lib/sensitiveEngine/lexiconLoader'
import type {
  LexiconJsonPayload,
  SensitiveCategory,
  SensitiveWord,
} from '../src/lib/sensitiveEngine/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const outDir = path.join(root, 'public', 'lexicon')
const outFile = path.join(outDir, 'sensitive.json')
const metaFile = path.join(outDir, 'sensitive.meta.json')

function dedupe(words: readonly SensitiveWord[]): SensitiveWord[] {
  const m = new Map<string, SensitiveWord>()
  for (const w of words) {
    const k = `${w.level}\0${w.category}\0${w.word.toLowerCase()}`
    if (!m.has(k)) m.set(k, w)
  }
  return [...m.values()]
}

/** 超出上限时保留 core 全部，其余按类别优先级 + 词长优先保留（长词通常更不易误伤）。 */
const CAT_PRIORITY: Record<SensitiveCategory, number> = {
  political: 0,
  violence: 1,
  illegal: 2,
  porn: 3,
  ad: 4,
  other: 5,
}

function trimLexicon(words: SensitiveWord[], maxTotal: number): SensitiveWord[] {
  if (maxTotal <= 0 || words.length <= maxTotal) return words
  const coreLc = new Set(SENSITIVE_CORE.map((w) => w.word.toLowerCase()))
  const isCore = (w: SensitiveWord) => coreLc.has(w.word.toLowerCase())
  const core = words.filter(isCore)
  const rest = words.filter((w) => !isCore(w))
  rest.sort((a, b) => {
    const d = CAT_PRIORITY[a.category] - CAT_PRIORITY[b.category]
    if (d !== 0) return d
    return b.word.length - a.word.length
  })
  const budget = Math.max(0, maxTotal - core.length)
  return [...core, ...rest.slice(0, budget)]
}

function main(): void {
  const rawMax = Number(process.env.FLOWID_LEXICON_MAX ?? 2800)
  const maxLexicon = Number.isFinite(rawMax) ? Math.trunc(rawMax) : 2800

  const merged = [...SENSITIVE_CORE, ...openSourceSensitiveWords]
  let uniq = dedupe(merged)
  const before = uniq.length
  uniq = trimLexicon(uniq, maxLexicon)
  if (uniq.length < before) {
    // eslint-disable-next-line no-console
    console.log(
      '[build:lexicon] trimmed',
      before - uniq.length,
      'entries (cap',
      maxLexicon,
      ', set FLOWID_LEXICON_MAX=0 to disable)',
    )
  }
  const builtAt = new Date().toISOString()
  const version = `lexicon-${builtAt.slice(0, 10).replace(/-/g, '')}-${uniq.length}`

  const payload: LexiconJsonPayload = {
    version,
    builtAt,
    total: uniq.length,
    entries: wordsToJsonEntries(uniq),
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(outFile, JSON.stringify(payload), 'utf8')
  writeFileSync(
    metaFile,
    JSON.stringify({ version, builtAt, total: uniq.length }),
    'utf8',
  )
  console.log('[build:lexicon] wrote', outFile, 'meta:', metaFile, 'entries:', uniq.length, 'version:', version)
}

main()
