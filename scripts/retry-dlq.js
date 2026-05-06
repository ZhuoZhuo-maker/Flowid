#!/usr/bin/env node
/**
 * 死信 pending 自动重试：调用本机 Points API POST /confirm，成功则更新死信为 resolved；
 * 失败则 retry_count+1，≥3 则标为 ignored（ignored_by=auto_retry）。
 *
 * 环境变量：DB_PATH、POINTS_API_BASE（默认 http://127.0.0.1:3721/pts）
 *
 * @example
 *   node scripts/retry-dlq.js
 *   node scripts/retry-dlq.js --once
 *
 * `--once` 与其它调度脚本约定一致；当前实现每次进程均只处理一批 pending，与是否带 `--once` 行为相同。
 */
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/backend/db/sqlite.js'

const base = String(process.env.POINTS_API_BASE || 'http://127.0.0.1:3721/pts').replace(/\/+$/, '')
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'flowid.db')

async function run() {
  const db = openDb(path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath))

  const pending = db
    .prepare(
      `SELECT id, license_code, machine_code, dedupe_key, retry_count FROM points_confirm_failures
       WHERE status = 'pending' ORDER BY id ASC LIMIT 200`,
    )
    .all()

  // eslint-disable-next-line no-console
  console.log(`[retry-dlq] pending 条数: ${pending.length} base=${base} argv=${JSON.stringify(process.argv.slice(2))}`)

  for (const row of pending) {
    const licenseCode = String(row.license_code || '')
    const machineCode = String(row.machine_code || '')
    const dedupeKey = String(row.dedupe_key || '')
    let ok = false
    let errMsg = ''
    try {
      const res = await fetch(`${base}/api/points/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseCode, machineCode, dedupeKey }),
      })
      const j = await res.json().catch(() => ({}))
      ok = Boolean(res.ok && j && j.success === true)
      if (!ok) errMsg = String(j?.message || res.statusText || 'confirm 失败')
    } catch (e) {
      errMsg = String(e?.message || e)
    }

    if (ok) {
      db.prepare(
        `UPDATE points_confirm_failures SET status = 'resolved', resolved_at = datetime('now'), resolved_by = 'auto_retry',
         ignored_at = NULL, ignored_by = NULL, retry_count = 0 WHERE id = ?`,
      ).run(row.id)
      // eslint-disable-next-line no-console
      console.log(`[retry-dlq] OK id=${row.id} dedupe=${dedupeKey.slice(0, 40)}…`)
    } else {
      const prev = Math.max(0, Math.trunc(Number(row.retry_count) || 0))
      const next = prev + 1
      if (next >= 3) {
        db.prepare(
          `UPDATE points_confirm_failures SET status = 'ignored', ignored_at = datetime('now'), ignored_by = 'auto_retry',
           retry_count = ? WHERE id = ?`,
        ).run(next, row.id)
        // eslint-disable-next-line no-console
        console.warn(`[retry-dlq] IGNORE id=${row.id} retry_count=${next} err=${errMsg}`)
      } else {
        db.prepare(`UPDATE points_confirm_failures SET retry_count = ? WHERE id = ?`).run(next, row.id)
        // eslint-disable-next-line no-console
        console.warn(`[retry-dlq] FAIL id=${row.id} retry_count=${next} err=${errMsg}`)
      }
    }
  }

  db.close()
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  run().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
