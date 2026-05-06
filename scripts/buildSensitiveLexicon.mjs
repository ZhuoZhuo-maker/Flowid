/**
 * 入口：由 package.json `build:lexicon` 调用，转交 tsx 执行 TS 构建逻辑。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const runner = path.join(__dirname, 'buildSensitiveLexicon.ts')

const r = spawnSync('npx', ['tsx', runner], {
  stdio: 'inherit',
  cwd: root,
  shell: true,
})
process.exit(r.status ?? 1)
