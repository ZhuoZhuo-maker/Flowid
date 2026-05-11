/**
 * 将 electron-builder 在 release/ 下的产物复制到 deliverables/Flowid_v{version}_windows_x64_installer/
 * 与历史交付目录命名保持一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = String(pkg.version || '0.0.0').trim()
const productName = String(pkg.build?.productName || pkg.name || 'Flowid').trim()
const deliverablesLabel = String(pkg.flowidDesktop?.deliverablesLabel || '').trim()
const labelSeg = deliverablesLabel ? `_${deliverablesLabel}` : ''
const releaseDir = path.join(root, 'release')
const destDir = path.join(root, 'deliverables', `Flowid_v${version}${labelSeg}_windows_x64_installer`)

const base = `${productName}_v${version}`
const candidates = [
  `${base}.exe`,
  `${base}.exe.blockmap`,
  'latest.yml',
]

if (!fs.existsSync(releaseDir)) {
  console.error('[stage-deliverables] 未找到 release/，请先执行 npm run desktop:build')
  process.exit(1)
}

fs.mkdirSync(destDir, { recursive: true })
let copied = 0
for (const name of candidates) {
  const from = path.join(releaseDir, name)
  if (!fs.existsSync(from)) {
    console.warn(`[stage-deliverables] 跳过（不存在）: ${name}`)
    continue
  }
  fs.copyFileSync(from, path.join(destDir, name))
  copied += 1
  console.log(`[stage-deliverables] 已复制: ${name}`)
}

if (copied === 0) {
  console.error('[stage-deliverables] release/ 下没有可复制的 exe/blockmap/yml')
  process.exit(1)
}

console.log(`[stage-deliverables] 完成 → ${destDir}`)
