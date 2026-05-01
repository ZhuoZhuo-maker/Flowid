import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const tsPath = path.join(root, 'src', 'lib', 'userAgreement.ts')
const outPath = path.join(root, 'server', 'user-agreement.json')

const s = fs.readFileSync(tsPath, 'utf8')
const vm = s.match(/export const USER_AGREEMENT_VERSION = '([^']+)'/)
const ver = vm ? vm[1] : '2026-04'
const tm = s.match(/export const USER_AGREEMENT_TEXT = `([\s\S]*?)`\s*$/)
if (!tm) {
  console.error('Could not parse USER_AGREEMENT_TEXT from', tsPath)
  process.exit(1)
}
const text = tm[1]
const out = { version: ver, text, updatedAtMs: Date.now() }
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8')
console.log('wrote', outPath, 'version=', ver, 'chars=', text.length)
