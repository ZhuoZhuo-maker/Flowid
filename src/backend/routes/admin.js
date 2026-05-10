/**
 * @fileoverview 管理接口：授权码 CRUD/分页、confirm 死信队列、手动重放（需 x-admin-token / ADMIN_TOKEN）。
 */
import crypto from 'node:crypto'
import { Router } from 'express'
import { formatLicenseDisplay, normalizeLicenseKey } from '../lib/codeNorm.js'
import { applyPointsRecharge, insertRechargeIfAbsent } from '../lib/pointsRechargeInternal.js'

const DLQ_STATUS = new Set(['pending', 'resolved', 'ignored'])

/** 是否允许管理接口「先删 points_log 再删授权码」（本地/测试清库；生产须显式 FLOWID_ALLOW_LICENSE_PURGE=1）。 */
export function allowPurgePointsLogForDelete() {
  const flag = String(process.env.FLOWID_ALLOW_LICENSE_PURGE || '').trim()
  if (flag === '1') return true
  if (flag === '0') return false
  const n = String(process.env.NODE_ENV || '').toLowerCase()
  return n !== 'production'
}

const DLQ_SELECT =
  `SELECT id, license_code, machine_code, dedupe_key, error_text, meta_json, status, retry_count,
          resolved_at, resolved_by, ignored_at, ignored_by, created_at
   FROM points_confirm_failures`

/** 排除易混淆：0 O I 1 */
const LICENSE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/**
 * @param {{ adminToken: string }} opts
 */
export function verifyAdminToken(opts) {
  const adminToken = String(opts.adminToken || '').trim()
  return (req, res, next) => {
    if (!adminToken) {
      return res.status(503).json({
        ok: false,
        message: '未配置 ADMIN_TOKEN / AUTH_ADMIN_SECRET（生产须设置其一；开发见 createPointsApp 默认口令）',
      })
    }
    const h = String(req.headers['x-admin-token'] || '')
    if (h !== adminToken) return res.status(403).json({ ok: false, message: '无效令牌' })
    next()
  }
}

/**
 * 管理台 HTML：校验 `x-admin-token` 或与之一致的 `?token=`（便于浏览器地址栏打开；生产勿外传带 token 的 URL）。
 * 未配置 ADMIN_TOKEN 时放行（仅依赖 API 侧校验）。
 */
export function verifyAdminHtmlAccess(opts) {
  const adminToken = String(opts.adminToken || '').trim()
  return (req, res, next) => {
    if (!adminToken) return next()
    const headerTok = String(req.headers['x-admin-token'] || '').trim()
    const rawQ = req.query?.token
    const queryTok = Array.isArray(rawQ)
      ? String(rawQ[0] || '').trim()
      : typeof rawQ === 'string'
        ? rawQ.trim()
        : ''
    const effective = headerTok || queryTok
    if (effective !== adminToken) {
      return res
        .status(401)
        .type('html')
        .send(
          `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>需要管理员令牌</title></head>` +
            `<body style="font-family:system-ui;padding:24px;background:#0f1419;color:#e6edf3;line-height:1.6">` +
            `<p>此管理页需要与 <code>ADMIN_TOKEN</code> 一致的访问凭证。</p>` +
            `<ul><li>在 URL 后附加 <code>?token=…</code>（勿分享链接）</li>` +
            `<li>或对请求添加请求头 <code>x-admin-token</code></li></ul>` +
            `<p><a href="/healthz" style="color:#58a6ff">/healthz</a> 无需令牌。</p></body></html>`,
        )
    }
    next()
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {'pending' | 'resolved' | 'ignored'} status
 * @param {string | null} actor 处理人/备注，写入 resolved_by 或 ignored_by
 */
function runDlqStatusUpdate(db, id, status, actor) {
  const by = actor && String(actor).trim() ? String(actor).trim().slice(0, 200) : null
  if (status === 'resolved') {
    db.prepare(
      `UPDATE points_confirm_failures SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ?,
       ignored_at = NULL, ignored_by = NULL, retry_count = 0 WHERE id = ?`,
    ).run(by, id)
  } else if (status === 'ignored') {
    db.prepare(
      `UPDATE points_confirm_failures SET status = 'ignored', ignored_at = datetime('now'), ignored_by = ?,
       resolved_at = NULL, resolved_by = NULL, retry_count = 0 WHERE id = ?`,
    ).run(by, id)
  } else {
    db.prepare(
      `UPDATE points_confirm_failures SET status = 'pending', resolved_at = NULL, resolved_by = NULL,
       ignored_at = NULL, ignored_by = NULL, retry_count = 0 WHERE id = ?`,
    ).run(id)
  }
}

/** @param {unknown} s */
function normalizeFilterInstant(s) {
  const t = String(s || '').trim()
  if (!t) return null
  const x = t.replace('T', ' ')
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x)) return `${x}:00`
  return x
}

/** LIKE 子串匹配：转义 % _ \，供 ESCAPE '\' 使用 */
function escapeLikeFragment(s) {
  return String(s || '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

/** @param {unknown} obj */
function safeJsonStringify(obj) {
  try {
    const s = JSON.stringify(obj ?? {})
    return typeof s === 'string' ? s.slice(0, 8000) : '{}'
  } catch {
    return '{}'
  }
}

/**
 * @param {string | null | undefined} existingStr
 * @param {Record<string, unknown>} patch
 */
function mergeMetaJson(existingStr, patch) {
  let o = {}
  try {
    const p = JSON.parse(String(existingStr || '{}'))
    if (p && typeof p === 'object' && !Array.isArray(p)) o = p
  } catch {
    o = {}
  }
  if (patch && typeof patch === 'object') Object.assign(o, patch)
  return safeJsonStringify(o)
}

/**
 * 释放仍为 reserve 的预扣（与 POST /points/cancel 用户取消语义一致）。
 * @param {import('better-sqlite3').Database} db
 */
function releaseStaleReserveForBatch(db, logRow, originalDedupeKey, adminTag) {
  if (String(logRow.type) !== 'reserve') return false
  const refund = Math.abs(Number(logRow.amount || 0))
  const display = String(logRow.license_code || '')
  const newKey = `${originalDedupeKey}:void:${logRow.id}`
  const merged = mergeMetaJson(logRow.meta_json, {
    adminBatchDlqRelease: true,
    adminTag: String(adminTag || '').slice(0, 200),
  })
  db.prepare(`UPDATE licenses SET points = points + ? WHERE code = ?`).run(refund, display)
  db.prepare(
    `UPDATE points_log SET type = 'cancelled', dedupe_key = ?, description = coalesce(description,'') || ' [cancelled]', meta_json = ? WHERE id = ?`,
  ).run(newKey, merged, logRow.id)
  return true
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function findPointsLogForDlq(db, licenseCode, originalDedupe) {
  const lc = String(licenseCode || '')
  const d = String(originalDedupe || '')
  let row = db.prepare(`SELECT * FROM points_log WHERE license_code = ? AND dedupe_key = ?`).get(lc, d)
  if (row) return row
  const esc = escapeLikeFragment(d)
  row = db
    .prepare(
      `SELECT * FROM points_log WHERE license_code = ? AND dedupe_key LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1`,
    )
    .get(lc, `${esc}:void:%`)
  return row || null
}

/**
 * 是否已做过「针对该 refund 流水 id」的批量补偿充值。
 * @param {import('better-sqlite3').Database} db
 * @param {number} refundLogId
 */
function batchRefundAlreadyApplied(db, refundLogId) {
  const dkNew = `admin-batch-refund:refund:${refundLogId}`
  const dkOld = `admin-batch-refund:${refundLogId}`
  return Boolean(db.prepare(`SELECT id FROM points_log WHERE dedupe_key IN (?, ?)`).get(dkNew, dkOld))
}

function randomBlock4() {
  let s = ''
  for (let i = 0; i < 4; i++) s += LICENSE_CHARSET[crypto.randomInt(LICENSE_CHARSET.length)]
  return s
}

function generateOneLicenseCode() {
  return `${randomBlock4()}-${randomBlock4()}-${randomBlock4()}-${randomBlock4()}`
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ adminToken: string }} opts
 */
export function createAdminRouter(db, opts) {
  const r = Router()
  r.use(verifyAdminToken(opts))

  /**
   * GET /server-hints — 管理页自检（如是否允许 purgeLogs 删码）。
   */
  r.get('/server-hints', (req, res) => {
    return res.json({
      ok: true,
      purgeLogsDeleteAllowed: allowPurgePointsLogForDelete(),
      nodeEnv: String(process.env.NODE_ENV || ''),
    })
  })

  /**
   * GET /licenses — 分页与筛选；无 page/pageSize 时兼容旧客户端（最多 2000 条）。
   * query: code?, search?（与 code 二选一语义：优先 search；任一匹配授权码或机器码）, statusFilter? (active|expired|revoked|all), page?, pageSize?
   */
  r.get('/licenses', (req, res) => {
    try {
      const legacy = req.query.page == null && req.query.pageSize == null
      const page = Math.max(1, Math.trunc(Number(req.query.page) || 1))
      const pageSize = legacy
        ? 2000
        : Math.min(100, Math.max(1, Math.trunc(Number(req.query.pageSize) || 20)))
      const offset = (page - 1) * pageSize

      const rawSt = req.query.statusFilter ?? req.query.status
      const stFilter =
        rawSt == null || String(rawSt).trim() === '' ? 'all' : String(rawSt).trim().toLowerCase()
      const searchRaw = String(req.query.search || '').trim()
      const codeRaw = String(req.query.code || '').trim()
      const effective = searchRaw || codeRaw
      const codePat = effective ? escapeLikeFragment(effective) : ''

      const conditions = []
      const params = []
      if (stFilter === 'active') {
        conditions.push(
          `(status = 'active' AND (expire_time IS NULL OR trim(expire_time) = '' OR datetime(expire_time) >= datetime('now')))`,
        )
      } else if (stFilter === 'expired') {
        conditions.push(
          `(status = 'active' AND expire_time IS NOT NULL AND trim(expire_time) != '' AND datetime(expire_time) < datetime('now'))`,
        )
      } else if (stFilter === 'revoked') {
        conditions.push(`status = 'revoked'`)
      } else if (stFilter !== '' && stFilter !== 'all') {
        return res.status(400).json({ ok: false, message: 'statusFilter 须为 active|expired|revoked|all' })
      }
      if (codePat) {
        const compact = effective.toUpperCase().replace(/[^0-9A-Z]/g, '')
        if (compact.length > 0) {
          conditions.push(
            `(code LIKE '%' || ? || '%' ESCAPE '\\' OR replace(upper(code),'-','') LIKE '%' || ? || '%' ESCAPE '\\' OR ifnull(machine_code,'') LIKE '%' || ? || '%' ESCAPE '\\')`,
          )
          params.push(codePat, escapeLikeFragment(compact), codePat)
        } else {
          conditions.push(
            `(code LIKE '%' || ? || '%' ESCAPE '\\' OR ifnull(machine_code,'') LIKE '%' || ? || '%' ESCAPE '\\')`,
          )
          params.push(codePat, codePat)
        }
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const countRow = db.prepare(`SELECT COUNT(*) AS c FROM licenses ${where}`).get(...params)
      const total = Number(countRow?.c || 0)
      const licenses = db
        .prepare(
          `SELECT code, machine_code, points, total_earned, total_spent, bind_time, expire_time, status, created_at
           FROM licenses ${where} ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, offset)

      return res.json({ ok: true, licenses, total, page: legacy ? 1 : page, pageSize })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '查询失败' })
    }
  })

  /**
   * POST /licenses — 批量生成授权码
   * body: { points, count, expireDays } expireDays 0 表示永久
   */
  r.post('/licenses', (req, res) => {
    try {
      const points = Math.trunc(Number(req.body?.points))
      const count = Math.trunc(Number(req.body?.count))
      const expireDays = Math.trunc(Number(req.body?.expireDays ?? 0))
      if (!Number.isFinite(points) || points < 0) {
        return res.status(400).json({ ok: false, message: 'points 无效' })
      }
      if (!Number.isFinite(count) || count < 1 || count > 500) {
        return res.status(400).json({ ok: false, message: 'count 须在 1~500' })
      }
      const expireIso =
        Number.isFinite(expireDays) && expireDays > 0
          ? new Date(Date.now() + expireDays * 864e5).toISOString()
          : null

      const insert = db.prepare(
        `INSERT INTO licenses (code, machine_code, points, total_earned, total_spent, bind_time, expire_time, status)
         VALUES (?, NULL, ?, ?, 0, NULL, ?, 'active')`,
      )

      const created = []
      let n = 0
      while (n < count) {
        const code = generateOneLicenseCode()
        try {
          insert.run(code, points, points, expireIso)
          const row = db.prepare(`SELECT code, points, expire_time, created_at, status FROM licenses WHERE code = ?`).get(code)
          if (row) created.push(row)
          n++
        } catch {
          /* 碰撞重试 */
        }
      }
      return res.json({ ok: true, created, count: created.length })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '生成失败' })
    }
  })

  /**
   * POST /licenses/:code/revoke — 禁用授权码（status → revoked）
   */
  r.post('/licenses/:code/revoke', (req, res) => {
    try {
      const raw = decodeURIComponent(String(req.params.code || '').trim())
      const key16 = normalizeLicenseKey(raw)
      const display = formatLicenseDisplay(key16) || raw
      const row = db.prepare(`SELECT code, status FROM licenses WHERE code = ?`).get(display)
      if (!row) return res.status(404).json({ ok: false, message: '授权码不存在' })
      if (String(row.status) === 'revoked') {
        return res.status(409).json({ ok: false, message: '状态冲突：已是 revoked' })
      }
      db.prepare(`UPDATE licenses SET status = 'revoked' WHERE code = ?`).run(display)
      return res.json({ ok: true })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '禁用失败' })
    }
  })

  /**
   * DELETE /licenses/:code — 删除授权码（未绑定且未过期 active 禁止；已绑定且仍有效禁止；存在 points_log 外键时失败）。
   * 测试清库：query `purgeLogs=1` 且环境允许时，先删该码的 points_log / confirm 死信再删 licenses（见 allowPurgePointsLogForDelete）。
   */
  r.delete('/licenses/:code', (req, res) => {
    try {
      const raw = decodeURIComponent(String(req.params.code || '').trim())
      const key16 = normalizeLicenseKey(raw)
      const display = formatLicenseDisplay(key16) || raw
      const q = String(req.query?.purgeLogs ?? req.query?.purge_logs ?? '').trim()
      const wantPurgeLogs = q === '1' || String(q).toLowerCase() === 'true'
      if (wantPurgeLogs && !allowPurgePointsLogForDelete()) {
        return res.status(403).json({
          ok: false,
          message:
            '未启用「清除流水后删除」。生产环境请设置 FLOWID_ALLOW_LICENSE_PURGE=1（或勿使用 purgeLogs）；若误设为 production 可改 NODE_ENV 或设置上述变量。',
        })
      }
      const row = db.prepare(`SELECT code, machine_code, expire_time, status FROM licenses WHERE code = ?`).get(display)
      if (!row) return res.status(404).json({ ok: false, message: '授权码不存在' })
      const bound = row.machine_code && String(row.machine_code).trim()
      const st = String(row.status || '')
      let expired = false
      const ex = row.expire_time && String(row.expire_time).trim()
      if (ex) {
        const ms = Date.parse(String(ex).replace(' ', 'T'))
        expired = Number.isFinite(ms) && ms < Date.now()
      }
      if (bound && st === 'active' && !expired) {
        return res.status(409).json({ ok: false, message: '已绑定且未过期，禁止删除' })
      }
      if (wantPurgeLogs && allowPurgePointsLogForDelete()) {
        const tx = db.transaction(() => {
          db.prepare(`DELETE FROM points_log WHERE license_code = ?`).run(display)
          db.prepare(`DELETE FROM points_confirm_failures WHERE license_code = ?`).run(display)
          db.prepare(`DELETE FROM licenses WHERE code = ?`).run(display)
        })
        tx()
        return res.json({ ok: true, purgedLogs: true })
      }
      try {
        db.prepare(`DELETE FROM licenses WHERE code = ?`).run(display)
      } catch (e) {
        const msg = String(e?.message || e)
        if (/FOREIGN KEY|constraint/i.test(msg)) {
          return res.status(409).json({
            ok: false,
            message:
              '存在积分流水引用，无法删除。测试请在管理页勾选「删码时清除积分流水」后重试；生产需 FLOWID_ALLOW_LICENSE_PURGE=1 且带 ?purgeLogs=1。',
          })
        }
        throw e
      }
      return res.json({ ok: true })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '删除失败' })
    }
  })

  /**
   * GET /confirm-failures?status=...&resolvedFrom=&resolvedTo=&ignoredFrom=&ignoredTo=&resolvedBy=&ignoredBy=
   */
  r.get('/confirm-failures', (req, res) => {
    try {
      const raw = String(req.query?.status || 'all').trim().toLowerCase()
      const status = raw === 'all' || raw === '' ? 'all' : raw
      if (status !== 'all' && !DLQ_STATUS.has(status)) {
        return res.status(400).json({ ok: false, message: 'status 须为 pending|resolved|ignored|all' })
      }

      const rf = normalizeFilterInstant(req.query?.resolvedFrom)
      const rt = normalizeFilterInstant(req.query?.resolvedTo)
      const igf = normalizeFilterInstant(req.query?.ignoredFrom)
      const igt = normalizeFilterInstant(req.query?.ignoredTo)
      const rbRaw = String(req.query?.resolvedBy || '').trim()
      const ibRaw = String(req.query?.ignoredBy || '').trim()
      const rb = rbRaw ? escapeLikeFragment(rbRaw) : ''
      const ib = ibRaw ? escapeLikeFragment(ibRaw) : ''

      const conditions = []
      const params = []
      if (status !== 'all') {
        conditions.push('status = ?')
        params.push(status)
      }
      if (rf || rt) {
        const from = rf || '1970-01-01 00:00:00'
        const to = rt || '9999-12-31 23:59:59'
        conditions.push(
          `(status != 'resolved' OR (resolved_at IS NOT NULL AND resolved_at >= ? AND resolved_at <= ?))`,
        )
        params.push(from, to)
      }
      if (igf || igt) {
        const from = igf || '1970-01-01 00:00:00'
        const to = igt || '9999-12-31 23:59:59'
        conditions.push(
          `(status != 'ignored' OR (ignored_at IS NOT NULL AND ignored_at >= ? AND ignored_at <= ?))`,
        )
        params.push(from, to)
      }
      if (rb) {
        conditions.push(`(resolved_by IS NOT NULL AND resolved_by LIKE '%' || ? || '%' ESCAPE '\\')`)
        params.push(rb)
      }
      if (ib) {
        conditions.push(`(ignored_by IS NOT NULL AND ignored_by LIKE '%' || ? || '%' ESCAPE '\\')`)
        params.push(ib)
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const rows = db.prepare(`${DLQ_SELECT} ${where} ORDER BY id DESC LIMIT 500`).all(...params)
      return res.json({ ok: true, rows })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '查询失败' })
    }
  })

  /**
   * POST /confirm-failures/status — 手动标记死信（不修改积分流水）。
   */
  r.post('/confirm-failures/status', (req, res) => {
    try {
      const status = String(req.body?.status || '').trim().toLowerCase()
      if (!DLQ_STATUS.has(status)) {
        return res.status(400).json({ ok: false, message: 'status 须为 pending|resolved|ignored' })
      }
      const actor = String(req.body?.actor || '').trim().slice(0, 200) || null

      const idsRaw = req.body?.ids
      if (Array.isArray(idsRaw) && idsRaw.length > 0) {
        const seen = new Set()
        const ids = []
        for (const x of idsRaw) {
          const id = Math.trunc(Number(x))
          if (!Number.isFinite(id) || id <= 0) continue
          if (seen.has(id)) continue
          seen.add(id)
          ids.push(id)
        }
        if (ids.length > 200) {
          return res.status(400).json({ ok: false, message: '单次最多 200 条 id' })
        }
        if (!ids.length) {
          return res.status(400).json({ ok: false, message: 'ids 中无有效 id' })
        }
        const missingIds = []
        /** @type {{ id: number; currentStatus: string; message: string }[]} */
        const failedIds = []
        let updated = 0
        for (const id of ids) {
          const row = db.prepare(`SELECT id, status FROM points_confirm_failures WHERE id = ?`).get(id)
          if (!row) {
            missingIds.push(id)
            continue
          }
          const cur = String(row.status || '')
          if (cur === status) {
            failedIds.push({
              id,
              currentStatus: cur,
              message: '状态冲突：记录已是目标状态',
            })
            continue
          }
          try {
            runDlqStatusUpdate(db, id, status, actor)
            updated += 1
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            failedIds.push({
              id,
              currentStatus: cur,
              message: msg.slice(0, 500),
            })
          }
        }
        return res.json({ ok: true, updated, missingIds, failedIds })
      }

      const id = Math.trunc(Number(req.body?.id))
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, message: '无效 id 或缺少 ids' })
      }
      const r0 = db.prepare(`SELECT id, status FROM points_confirm_failures WHERE id = ?`).get(id)
      if (!r0) return res.status(404).json({ ok: false, message: '记录不存在' })
      if (String(r0.status) === status) {
        return res.status(409).json({
          ok: false,
          message: '状态冲突：记录已是目标状态',
          currentStatus: String(r0.status || ''),
        })
      }
      runDlqStatusUpdate(db, id, status, actor)
      return res.json({ ok: true })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '更新失败' })
    }
  })

  /**
   * POST /replay-confirm
   */
  r.post('/replay-confirm', (req, res) => {
    try {
      const dedupeKey = String(req.body?.dedupeKey || '').trim()
      if (!dedupeKey) return res.json({ ok: false, message: '缺少 dedupeKey' })

      const logRow = db
        .prepare(`SELECT * FROM points_log WHERE dedupe_key = ? AND type = 'reserve'`)
        .get(dedupeKey)

      if (!logRow) {
        const any = db.prepare(`SELECT * FROM points_log WHERE dedupe_key = ?`).get(dedupeKey)
        if (any && String(any.type) === 'consume') {
          db.prepare(
            `UPDATE points_confirm_failures SET status = 'resolved', resolved_at = datetime('now'), resolved_by = 'replay',
             ignored_at = NULL, ignored_by = NULL, retry_count = 0 WHERE dedupe_key = ?`,
          ).run(dedupeKey)
          const lic = db.prepare('SELECT points FROM licenses WHERE code = ?').get(String(any.license_code))
          return res.json({
            ok: true,
            idempotent: true,
            message: '流水已是 consume，已同步将死信标为 resolved',
            remainingPoints: Number(lic?.points || 0),
          })
        }
        return res.json({ ok: false, message: '未找到 reserve 流水（可能已确认/已取消或键无效）' })
      }

      const display = String(logRow.license_code || '')
      const lic = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
      if (!lic) return res.json({ ok: false, message: '授权码不存在' })
      if (String(lic.status) !== 'active') {
        return res.json({ ok: false, message: '授权不可用' })
      }

      const spentAmt = Math.abs(Number(logRow.amount || 0))
      const remaining = db.transaction(() => {
        const cur = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
        const ts = Number(cur.total_spent || 0) + spentAmt
        db.prepare(`UPDATE licenses SET total_spent = ? WHERE code = ?`).run(ts, display)
        db.prepare(`UPDATE points_log SET type = 'consume' WHERE id = ?`).run(logRow.id)
        db.prepare(
          `UPDATE points_confirm_failures SET status = 'resolved', resolved_at = datetime('now'), resolved_by = 'replay',
           ignored_at = NULL, ignored_by = NULL, retry_count = 0 WHERE dedupe_key = ?`,
        ).run(dedupeKey)
        return Number(cur.points || 0)
      })()

      return res.json({ ok: true, remainingPoints: remaining })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '重放失败' })
    }
  })

  /**
   * POST /batch-refund — 批量补偿（与 POST /api/points/recharge 同一套入账逻辑，可选 dedupe 幂等）：
   * 1) points_log type=refund 且时间在窗内（已补偿的 dedupe 不重复入账）
   * 2) points_confirm_failures status=pending 且时间在窗内：若关联流水仍为 reserve 则先释放预扣再充值；若已为 consume 则仅关闭死信
   * body: { fromTime, toTime, errorPattern?, workflowName?, reason?, processRefundLogs?, processDlqPending? }
   */
  r.post('/batch-refund', (req, res) => {
    try {
      const fromRaw = normalizeFilterInstant(req.body?.fromTime)
      const toRaw = normalizeFilterInstant(req.body?.toTime)
      if (!fromRaw || !toRaw) {
        return res.status(400).json({ ok: false, message: 'fromTime 与 toTime 必填（ISO 或本地时间字符串）' })
      }
      const reason = String(req.body?.reason || '批量补偿').slice(0, 500)
      const errorPattern = String(req.body?.errorPattern || '').trim()
      const workflowName = String(req.body?.workflowName || '').trim()
      const processRefundLogs = req.body?.processRefundLogs !== false
      const processDlqPending = req.body?.processDlqPending !== false

      const desc = `[admin] 批量补偿：${reason}`.slice(0, 500)

      /** @type {{ matched: number; credited: number; skipped: number; creditedIds: number[] }} */
      const refundStats = { matched: 0, credited: 0, skipped: 0, creditedIds: [] }
      /** @type {{ matched: number; credited: number; skipped: number; resolvedOnly: number; creditedIds: number[] }} */
      const dlqStats = { matched: 0, credited: 0, skipped: 0, resolvedOnly: 0, creditedIds: [] }

      if (processRefundLogs) {
        let sql = `SELECT id, license_code, amount, meta_json, created_at, dedupe_key
          FROM points_log
          WHERE type = 'refund' AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
        const params = [fromRaw, toRaw]
        if (errorPattern) {
          const esc = escapeLikeFragment(errorPattern)
          sql += ` AND coalesce(meta_json,'') LIKE '%' || ? || '%' ESCAPE '\\'`
          params.push(esc)
        }
        if (workflowName) {
          const esc = escapeLikeFragment(workflowName)
          sql += ` AND coalesce(meta_json,'') LIKE '%' || ? || '%' ESCAPE '\\'`
          params.push(esc)
        }
        sql += ` ORDER BY id ASC LIMIT 2000`
        const candidates = db.prepare(sql).all(...params)
        refundStats.matched = candidates.length

        for (const row of candidates) {
          if (batchRefundAlreadyApplied(db, row.id)) {
            refundStats.skipped += 1
            continue
          }
          const amt = Math.abs(Number(row.amount || 0))
          if (!amt) {
            refundStats.skipped += 1
            continue
          }
          const lic = db.prepare(`SELECT * FROM licenses WHERE code = ?`).get(row.license_code)
          if (!lic || String(lic.status) !== 'active') {
            refundStats.skipped += 1
            continue
          }

          const dk = `admin-batch-refund:refund:${row.id}`
          const r0 = applyPointsRecharge(db, {
            licenseCode: row.license_code,
            amount: amt,
            description: desc,
            dedupeKey: dk,
            metaJson: safeJsonStringify({
              adminBatchRefund: true,
              sourceRefundLogId: row.id,
              sourceRefundAt: row.created_at,
              reason,
            }),
          })
          if (!r0.ok) {
            refundStats.skipped += 1
            continue
          }
          if (r0.skipped) {
            refundStats.skipped += 1
            continue
          }
          refundStats.credited += 1
          refundStats.creditedIds.push(row.id)
        }
      }

      if (processDlqPending) {
        let dlqSql = `${DLQ_SELECT}
          WHERE status = 'pending'
          AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
        const dp = [fromRaw, toRaw]
        if (errorPattern) {
          const esc = escapeLikeFragment(errorPattern)
          dlqSql += ` AND (coalesce(error_text,'') LIKE '%' || ? || '%' ESCAPE '\\' OR coalesce(meta_json,'') LIKE '%' || ? || '%' ESCAPE '\\')`
          dp.push(esc, esc)
        }
        if (workflowName) {
          const esc = escapeLikeFragment(workflowName)
          dlqSql += ` AND coalesce(meta_json,'') LIKE '%' || ? || '%' ESCAPE '\\'`
          dp.push(esc)
        }
        dlqSql += ` ORDER BY id ASC LIMIT 2000`
        const dlqRows = db.prepare(dlqSql).all(...dp)
        dlqStats.matched = dlqRows.length

        for (const dlq of dlqRows) {
          const dk = `admin-batch-refund:dlq:${dlq.id}`
          if (db.prepare(`SELECT id FROM points_log WHERE dedupe_key = ?`).get(dk)) {
            dlqStats.skipped += 1
            continue
          }

          const logRow = findPointsLogForDlq(db, dlq.license_code, dlq.dedupe_key)
          if (!logRow) {
            dlqStats.skipped += 1
            continue
          }

          const amt0 = Math.abs(Number(logRow.amount || 0))
          if (!amt0) {
            dlqStats.skipped += 1
            continue
          }

          const lic = db.prepare(`SELECT * FROM licenses WHERE code = ?`).get(dlq.license_code)
          if (!lic || String(lic.status) !== 'active') {
            dlqStats.skipped += 1
            continue
          }

          /** @type {'skip' | 'resolved_only' | 'credited'} */
          let outcome = 'skip'
          try {
            db.transaction(() => {
              const fresh = db.prepare(`SELECT * FROM points_log WHERE id = ?`).get(logRow.id)
              if (!fresh) throw new Error('log_missing')
              const t = String(fresh.type || '')
              if (t === 'consume') {
                runDlqStatusUpdate(db, dlq.id, 'resolved', 'batch-refund:already-consumed')
                outcome = 'resolved_only'
                return
              }
              if (t === 'reserve') {
                releaseStaleReserveForBatch(db, fresh, dlq.dedupe_key, reason)
              }
              const rIns = insertRechargeIfAbsent(db, {
                licenseCode: dlq.license_code,
                amount: amt0,
                description: desc,
                dedupeKey: dk,
                metaJson: safeJsonStringify({
                  adminBatchRefundDlq: true,
                  dlqId: dlq.id,
                  sourceDedupeKey: dlq.dedupe_key,
                  pointsLogId: fresh.id,
                  reason,
                }),
              })
              if (!rIns.ok) throw new Error(String(rIns.error || 'recharge_failed'))
              if (rIns.skipped) {
                runDlqStatusUpdate(db, dlq.id, 'resolved', 'batch-refund:recharge-dedupe')
                outcome = 'resolved_only'
              } else {
                runDlqStatusUpdate(db, dlq.id, 'resolved', `[admin] batch-refund: ${reason}`.slice(0, 200))
                outcome = 'credited'
              }
            })()
          } catch {
            dlqStats.skipped += 1
            continue
          }

          if (outcome === 'credited') {
            dlqStats.credited += 1
            dlqStats.creditedIds.push(dlq.id)
          } else if (outcome === 'resolved_only') {
            dlqStats.resolvedOnly += 1
          } else {
            dlqStats.skipped += 1
          }
        }
      }

      return res.json({
        ok: true,
        reason,
        credited: refundStats.credited + (processDlqPending ? dlqStats.credited : 0),
        skipped: refundStats.skipped + (processDlqPending ? dlqStats.skipped : 0),
        refundLogs: processRefundLogs ? refundStats : null,
        dlq: processDlqPending ? dlqStats : null,
      })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '批量补偿失败' })
    }
  })

  /**
   * GET /points-pricing — 列出积分单价规则（base:… / workflow:… / model:…）。
   */
  r.get('/points-pricing', (_req, res) => {
    try {
      const rules = db
        .prepare(
          `SELECT rule_key AS ruleKey, points, coalesce(label,'') AS label, updated_at AS updatedAt
           FROM points_price_rules ORDER BY rule_key ASC`,
        )
        .all()
      return res.json({ ok: true, rules })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '查询失败' })
    }
  })

  /**
   * PUT /points-pricing — 新增或更新一条规则。
   * body: { ruleKey: string, points: number, label?: string }
   */
  r.put('/points-pricing', (req, res) => {
    try {
      const ruleKey = String(req.body?.ruleKey || '').trim()
      const points = Math.trunc(Number(req.body?.points))
      const labelRaw = req.body?.label
      const label =
        labelRaw == null || String(labelRaw).trim() === '' ? null : String(labelRaw).trim().slice(0, 200)
      if (!ruleKey || ruleKey.length > 300) {
        return res.status(400).json({ ok: false, message: 'ruleKey 无效' })
      }
      if (!Number.isFinite(points) || points < 1 || points > 1_000_000_000) {
        return res.status(400).json({ ok: false, message: 'points 须为 1～1e9 的整数' })
      }
      db.prepare(
        `INSERT INTO points_price_rules (rule_key, points, label, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(rule_key) DO UPDATE SET points = excluded.points, label = excluded.label, updated_at = datetime('now')`,
      ).run(ruleKey, points, label)
      return res.json({ ok: true })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '保存失败' })
    }
  })

  /**
   * DELETE /points-pricing — 删除自定义规则（慎用；删除后计价回退到 base 或内置 fallback）。
   * body: { ruleKey: string }
   */
  r.delete('/points-pricing', (req, res) => {
    try {
      const ruleKey = String(req.body?.ruleKey || '').trim()
      if (!ruleKey || ruleKey.length > 300) {
        return res.status(400).json({ ok: false, message: 'ruleKey 无效' })
      }
      const info = db.prepare(`DELETE FROM points_price_rules WHERE rule_key = ?`).run(ruleKey)
      return res.json({ ok: true, deleted: Number(info.changes || 0) })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ ok: false, message: '删除失败' })
    }
  })

  return r
}
