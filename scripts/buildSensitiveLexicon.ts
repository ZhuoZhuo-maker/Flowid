/**
 * 合并 `sensitiveCore` + `sensitiveLexiconOpenSource.generated` → `public/lexicon/sensitive.json`
 * 运行：`npm run build:lexicon`（内部用 tsx 执行本文件）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SENSITIVE_CORE } from '../src/data/sensitiveCore'
import { openSourceSensitiveWords } from '../src/data/sensitiveLexiconOpenSource.generated'
import { wordsToJsonEntries } from '../src/lib/sensitiveEngine/lexiconLoader'
import type { LexiconJsonPayload, SensitiveWord } from '../src/lib/sensitiveEngine/types'

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

function main(): void {
  const merged = [...SENSITIVE_CORE, ...openSourceSensitiveWords]
  const uniq = dedupe(merged)
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
