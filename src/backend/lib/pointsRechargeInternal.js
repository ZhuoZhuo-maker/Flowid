/**
 * @fileoverview 与 POST /api/points/recharge 相同的入账逻辑；可选 dedupe_key 用于幂等。
 */
import { formatLicenseDisplay, normalizeLicenseKey } from './codeNorm.js'

/**
 * 在**当前** better-sqlite3 事务内写入充值（不再开启嵌套 transaction）。
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   licenseCode: string
 *   amount: number
 *   description: string
 *   dedupeKey?: string | null
 *   metaJson?: string | null
 * }} p
 * @returns {{ ok: true; newBalance: number } | { ok: false; error: string } | { ok: true; skipped: true; newBalance: number }}
 */
export function insertRechargeIfAbsent(db, p) {
  const key16 = normalizeLicenseKey(String(p.licenseCode || ''))
  const display = formatLicenseDisplay(key16)
  const amount = Math.trunc(Number(p.amount))
  const description = String(p.description || '').slice(0, 500)
  const dedupeKey = p.dedupeKey != null && String(p.dedupeKey).trim() ? String(p.dedupeKey).trim() : ''
  const metaJson =
    p.metaJson != null && String(p.metaJson).trim() ? String(p.metaJson).slice(0, 8000) : null

  if (!display || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid_params' }
  }

  const lic0 = db.prepare(`SELECT * FROM licenses WHERE code = ?`).get(display)
  if (!lic0) return { ok: false, error: 'not_found' }
  if (String(lic0.status) !== 'active') return { ok: false, error: 'inactive' }

  if (dedupeKey) {
    const ex = db.prepare(`SELECT id FROM points_log WHERE dedupe_key = ?`).get(dedupeKey)
    if (ex) return { ok: true, skipped: true, newBalance: Number(lic0.points || 0) }
  }

  const cur = db.prepare(`SELECT * FROM licenses WHERE code = ?`).get(display)
  const pts = Number(cur.points || 0)
  const after = pts + amount
  const te = Number(cur.total_earned || 0) + amount
  db.prepare(`UPDATE licenses SET points = ?, total_earned = ? WHERE code = ?`).run(after, te, display)
  if (dedupeKey) {
    db.prepare(
      `INSERT INTO points_log (license_code, amount, type, description, before_points, after_points, dedupe_key, meta_json)
       VALUES (?, ?, 'recharge', ?, ?, ?, ?, ?)`,
    ).run(display, amount, description, pts, after, dedupeKey, metaJson)
  } else {
    db.prepare(
      `INSERT INTO points_log (license_code, amount, type, description, before_points, after_points)
       VALUES (?, ?, 'recharge', ?, ?, ?)`,
    ).run(display, amount, description, pts, after)
  }
  return { ok: true, newBalance: after }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   licenseCode: string
 *   amount: number
 *   description: string
 *   dedupeKey?: string | null
 *   metaJson?: string | null
 * }} p
 * @returns {{ ok: true; newBalance: number; idempotent?: boolean; skipped?: boolean } | { ok: false; error: string }}
 */
export function applyPointsRecharge(db, p) {
  const key16 = normalizeLicenseKey(String(p.licenseCode || ''))
  const display = formatLicenseDisplay(key16)
  const amount = Math.trunc(Number(p.amount))
  if (!display || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid_params' }
  }

  const dedupeKey = p.dedupeKey != null && String(p.dedupeKey).trim() ? String(p.dedupeKey).trim() : ''
  if (dedupeKey) {
    const ex = db.prepare(`SELECT id FROM points_log WHERE dedupe_key = ?`).get(dedupeKey)
    if (ex) {
      const lic0 = db.prepare(`SELECT points FROM licenses WHERE code = ?`).get(display)
      return {
        ok: true,
        idempotent: true,
        skipped: true,
        newBalance: Number(lic0?.points || 0),
      }
    }
  }

  try {
    const out = db.transaction(() => insertRechargeIfAbsent(db, p))()
    if (!out.ok) return out
    if ('skipped' in out && out.skipped) {
      return { ok: true, idempotent: true, skipped: true, newBalance: out.newBalance }
    }
    return { ok: true, newBalance: out.newBalance }
  } catch (e) {
    console.error(e)
    return { ok: false, error: 'tx_failed' }
  }
}
