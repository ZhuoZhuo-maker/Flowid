/**
 * 性能探测：读取 public/lexicon/sensitive.json 构建 AC，对样本文本跑多次 check。
 * 运行：`npm run bench:sensitive`
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AhoCorasick } from '../src/lib/sensitiveEngine/acEngine'
import { entryToWord } from '../src/lib/sensitiveEngine/types'
import type { LexiconJsonPayload } from '../src/lib/sensitiveEngine/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const jsonPath = path.join(root, 'public', 'lexicon', 'sensitive.json')

const sample =
  '这是一段约五百字的占位描述，用于压测敏感词扫描。赌博 毒品 诈骗 杀人 炸弹 恐怖袭击 自杀 刷单 黄色网站 约炮 裸聊 91视频 麻豆 冰毒 fa lun gong tai du zang du jiang du gong chan ' +
  'repeat '.repeat(80)

function main(): void {
  const raw = readFileSync(jsonPath, 'utf8')
  const data = JSON.parse(raw) as LexiconJsonPayload
  const words = data.entries.map(entryToWord)
  console.log('entries:', words.length, 'sample chars:', sample.length)

  console.time('build-ac')
  const ac = new AhoCorasick(words)
  console.timeEnd('build-ac')

  const runs = 200
  console.time(`check x${runs}`)
  for (let i = 0; i < runs; i++) {
    ac.check(sample)
  }
  console.timeEnd(`check x${runs}`)
  const once = ac.check(sample)
  console.log('last check:', once.level, 'blocked:', once.blockedCount, 'warning:', once.warningCount)
}

main()
