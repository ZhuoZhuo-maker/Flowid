#!/usr/bin/env node
/**
 * 批量生成授权码并写入 SQLite + 导出 CSV。
 *
 * @example
 *   npm run gen-license -- --points 1000 --count 10
 *   npm run gen-license -- --points 500 --count 5 --expireDays 30
 *   npm run gen-license -- --points 200 --count 3 --expireDays 0
 *   npm run gen-license -- --db ./data/flowid.db
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/backend/db/sqlite.js'

function parseArgs(argv) {
  const out = { points: 1000, count: 10, expireDays: 0, db: path.join(process.cwd(), 'data', 'flowid.db') }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--points') out.points = Math.trunc(Number(argv[++i]))
    else if (a === '--count') out.count = Math.trunc(Number(argv[++i]))
    else if (a === '--expireDays') out.expireDays = Math.trunc(Number(argv[++i]))
    else if (a === '--db') out.db = String(argv[++i] || '').trim()
  }
  if (!Number.isFinite(out.points) || out.points < 0) throw new Error('invalid --points')
  if (!Number.isFinite(out.count) || out.count < 1 || out.count > 10_000) throw new Error('invalid --count')
  if (!Number.isFinite(out.expireDays) || out.expireDays < 0) throw new Error('invalid --expireDays')
  return out
}

/** 排除易混淆：0 O I 1 */
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function randomBlock4() {
  let s = ''
  for (let i = 0; i < 4; i++) s += CHARSET[crypto.randomInt(CHARSET.length)]
  return s
}

function generateOneCode() {
  return `${randomBlock4()}-${randomBlock4()}-${randomBlock4()}-${randomBlock4()}`
}

function stampForFilename() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function main() {
  const opts = parseArgs(process.argv)
  const resolved = path.isAbsolute(opts.db) ? opts.db : path.resolve(process.cwd(), opts.db)
  const db = openDb(resolved)

  const expireIso =
    opts.expireDays > 0 ? new Date(Date.now() + opts.expireDays * 864e5).toISOString() : null

  const insert = db.prepare(
    `INSERT INTO licenses (code, machine_code, points, total_earned, total_spent, bind_time, expire_time, status)
     VALUES (?, NULL, ?, ?, 0, NULL, ?, 'active')`,
  )

  const rows = []
  let n = 0
  while (n < opts.count) {
    const code = generateOneCode()
    try {
      insert.run(code, opts.points, opts.points, expireIso)
      const row = db
        .prepare(`SELECT code, points, expire_time, created_at, status FROM licenses WHERE code = ?`)
        .get(code)
      if (row) rows.push(row)
      n++
    } catch {
      /* UNIQUE 冲突则重试 */
    }
  }

  const exportDir = path.join(process.cwd(), 'exports')
  fs.mkdirSync(exportDir, { recursive: true })
  const csvPath = path.join(exportDir, `licenses_${stampForFilename()}.csv`)
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const lines = [
    'code,points,expire_time,created_at,status',
    ...rows.map((r) =>
      [r.code, r.points, r.expire_time ?? '', r.created_at ?? '', r.status ?? 'active'].map(esc).join(','),
    ),
  ]
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf8')

  // eslint-disable-next-line no-console
  console.log(`写入数据库: ${resolved}`)
  // eslint-disable-next-line no-console
  console.log(`导出 CSV: ${csvPath}`)
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(r.code, r.points, r.expire_time || '(永久)', r.created_at, r.status)
  }
  db.close()
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
