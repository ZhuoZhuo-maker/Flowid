/**
 * @fileoverview /api/points/* — 扣减、预扣/确认/取消、充值、余额、流水。
 */
import { Router } from 'express'
import { formatLicenseDisplay, normalizeLicenseKey, normalizeMachineCode } from '../lib/codeNorm.js'
import { applyPointsRecharge } from '../lib/pointsRechargeInternal.js'

/**
 * @param {unknown} obj
 * @returns {string}
 */
function safeJsonStringify(obj) {
  try {
    const s = JSON.stringify(obj ?? {})
    return typeof s === 'string' ? s.slice(0, 8000) : '{}'
  } catch {
    return '{}'
  }
}

/**
 * @param {string | null | undefined} s
 * @returns {Record<string, unknown>}
 */
function parseMetaObj(s) {
  try {
    const o = JSON.parse(String(s || '{}'))
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

/**
 * @param {string | null | undefined} existingStr
 * @param {Record<string, unknown> | null | undefined} patch
 * @returns {string}
 */
function mergeMetaJson(existingStr, patch) {
  const o = parseMetaObj(existingStr)
  if (patch && typeof patch === 'object') {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) o[k] = v
    }
  }
  return safeJsonStringify(o)
}

/**
 * @param {string} raw
 */
function parseKindSet(raw) {
  const s = new Set()
  for (const p of String(raw || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    s.add(p)
  }
  return s
}

/**
 * POST Auth `POST /license/verify`：校验 JWT 会员码是否有效且含 proTemplates。
 * @param {string} verifyUrl
 * @param {string} licenseCode
 * @param {string} machineId
 */
async function authLicenseHasProTemplates(verifyUrl, licenseCode, machineId) {
  const url = String(verifyUrl || '').trim()
  const lc = String(licenseCode || '').trim()
  const mid = String(machineId || '').trim()
  if (!url || !lc || !mid) return false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseCode: lc, machineId: mid }),
    })
    const data = /** @type {Record<string, unknown>} */ (await res.json().catch(() => ({})))
    if (!res.ok) return false
    const exp = Number(data.expiresAtMs || 0)
    if (!Number.isFinite(exp) || exp <= Date.now()) return false
    const ent = data.entitlements
    if (!ent || typeof ent !== 'object' || Array.isArray(ent)) return false
    return Boolean(/** @type {Record<string, unknown>} */ (ent).proTemplates)
  } catch {
    return false
  }
}

/**
 * @param {string} s
 */
function slugPricingKeyPart(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .slice(0, 200)
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} nodeKind
 * @param {string} executionTarget
 * @param {unknown} metadata
 * @returns {{ points: number; matchedRuleKey: string }}
 */
function resolvePointsPrice(db, _nodeKind, executionTarget, metadata) {
  const et = String(executionTarget || 'workflow').trim()
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
  const wfRaw = String(meta.workflowName || '').trim()
  const mdRaw = String(meta.cloudModelName || '').trim()
  const billingKind = String(meta.pointsBillingKind || '').trim()

  /** 本地 Comfy 工作流：不扣积分（客户端需传 pointsBillingKind=local_workflow） */
  if (billingKind === 'local_workflow') {
    return { points: 0, matchedRuleKey: 'billing:local_workflow' }
  }

  /** 仅按 model: / workflow: 精确规则扣费；不再使用 base: 与内置数字兜底（避免与云端目录规则「不同步」） */
  if (et === 'model' && mdRaw) {
    if (!billingKind || billingKind === 'cloud_model') {
      const k = `model:${slugPricingKeyPart(mdRaw)}`
      const row = db.prepare('SELECT points FROM points_price_rules WHERE rule_key = ?').get(k)
      if (row && Number(row.points) > 0) {
        return { points: Math.trunc(Number(row.points)), matchedRuleKey: k }
      }
      return { points: 0, matchedRuleKey: 'model:no_rule' }
    }
  }
  if (et === 'workflow' && wfRaw) {
    if (!billingKind || billingKind === 'cloud_workflow') {
      const k = `workflow:${slugPricingKeyPart(wfRaw)}`
      const row = db.prepare('SELECT points FROM points_price_rules WHERE rule_key = ?').get(k)
      if (row && Number(row.points) > 0) {
        return { points: Math.trunc(Number(row.points)), matchedRuleKey: k }
      }
      return { points: 0, matchedRuleKey: 'workflow:no_rule' }
    }
  }
  return { points: 0, matchedRuleKey: 'billing:none' }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   adminToken?: string
 *   authLicenseVerifyUrl?: string
 *   proMembershipNodeKinds?: string
 * }} [opts]
 * opts.authLicenseVerifyUrl：Auth `POST /license/verify` 完整 URL（createPointsApp 默认 3721）。
 * opts.proMembershipNodeKinds：逗号分隔的 nodeKind，非空则 reserve 需附带 authLicenseCode + authMachineId 且校验 proTemplates。
 * 若配置 ADMIN_TOKEN，则 recharge 需携带 x-admin-token。
 */
export function createPointsRouter(db, opts = {}) {
  const adminToken = opts.adminToken ? String(opts.adminToken).trim() : ''
  const proKindSet = parseKindSet(opts.proMembershipNodeKinds || '')
  const authVerifyUrl = String(opts.authLicenseVerifyUrl || '').trim()

  const r = Router()

  function requireAdmin(req) {
    if (!adminToken) return true
    const h = String(req.headers['x-admin-token'] || '')
    return h === adminToken
  }

  /**
   * POST /reserve — 预扣：扣减余额并写入 type=reserve；同一 dedupeKey 幂等。
   */
  r.post('/reserve', async (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      const dedupeKey = String(req.body?.dedupeKey || '').trim()
      const nodeKind = String(req.body?.nodeKind || '').trim()
      const executionTarget = String(req.body?.executionTarget || 'workflow').trim()
      const metadata = req.body?.metadata
      if (!key16 || !machineCode || !dedupeKey || dedupeKey.length > 400) {
        return res.json({ success: false, message: '参数无效' })
      }

      const nkLower = nodeKind.trim().toLowerCase()
      if (proKindSet.size > 0 && proKindSet.has(nkLower)) {
        const authLc = String(req.body?.authLicenseCode || '').trim()
        const authMid = String(req.body?.authMachineId || req.body?.authMachineCode || '').trim()
        if (!authLc || !authMid) {
          return res.json({
            success: false,
            error: 'need_pro_membership',
            message:
              '此节点类型需 Auth 会员（proTemplates）；请在请求体附带 authLicenseCode 与 authMachineId，或调整环境变量 POINTS_PRO_MEMBERSHIP_NODE_KINDS',
          })
        }
        const ok = await authLicenseHasProTemplates(authVerifyUrl, authLc, authMid)
        if (!ok) {
          return res.json({
            success: false,
            error: 'need_pro_membership',
            message: '会员资格校验未通过（Auth /license/verify 无效或无 proTemplates 权益）',
          })
        }
      }

      const existing = db.prepare('SELECT id, type, after_points FROM points_log WHERE dedupe_key = ?').get(dedupeKey)
      if (existing?.type === 'consume') {
        const row = db.prepare('SELECT points FROM licenses WHERE code = ?').get(display)
        return res.json({
          success: true,
          remainingPoints: Number(row?.points || 0),
          idempotent: true,
          phase: 'done',
        })
      }
      if (existing?.type === 'reserve') {
        const row = db.prepare('SELECT points FROM licenses WHERE code = ?').get(display)
        return res.json({
          success: true,
          remainingPoints: Number(row?.points || 0),
          idempotent: true,
          phase: 'reserved',
        })
      }
      if (existing?.type === 'cancelled' || existing?.type === 'refund') {
        return res.json({ success: false, message: 'dedupeKey 已用于已释放/已退款流水，请使用新键' })
      }

      const { points: amount } = resolvePointsPrice(db, nodeKind, executionTarget, metadata)
      const metaJson = safeJsonStringify(metadata)
      const description = `reserve:${nodeKind}:${executionTarget}`.slice(0, 500)

      const tx = db.transaction(() => {
        const row = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
        if (!row) throw new Error('not_found')
        if (String(row.status) !== 'active') throw new Error('inactive')
        if (String(row.machine_code || '').trim() !== machineCode) throw new Error('machine')
        const pts = Number(row.points || 0)
        if (pts < amount) throw new Error('insufficient')
        const after = pts - amount
        db.prepare(`UPDATE licenses SET points = ? WHERE code = ?`).run(after, display)
        db.prepare(
          `INSERT INTO points_log (license_code, amount, type, description, before_points, after_points, dedupe_key, meta_json)
           VALUES (?, ?, 'reserve', ?, ?, ?, ?, ?)`,
        ).run(display, -amount, description, pts, after, dedupeKey, metaJson)
        return after
      })

      const remaining = tx()
      return res.json({ success: true, remainingPoints: remaining, charged: amount })
    } catch (e) {
      const m = String(e?.message || e)
      if (m === 'not_found') return res.json({ success: false, message: '授权码不存在' })
      if (m === 'inactive') return res.json({ success: false, message: '授权不可用' })
      if (m === 'machine') return res.json({ success: false, message: '机器码不匹配' })
      if (m === 'insufficient') return res.json({ success: false, message: '积分不足' })
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误' })
    }
  })

  /**
   * POST /quote — 预估单次执行预扣积分（与 /reserve 计价一致，不扣款）。
   */
  r.post('/quote', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      const nodeKind = String(req.body?.nodeKind || '').trim()
      const executionTarget = String(req.body?.executionTarget || 'workflow').trim()
      const metadata = req.body?.metadata
      if (!key16 || !machineCode || !nodeKind) {
        return res.json({ success: false, message: '参数无效', points: 0 })
      }

      const lic = db.prepare('SELECT points, machine_code, status FROM licenses WHERE code = ?').get(display)
      if (!lic) return res.json({ success: false, message: '授权码不存在', points: 0 })
      if (String(lic.status) !== 'active') {
        return res.json({ success: false, message: '授权不可用', points: 0 })
      }
      if (String(lic.machine_code || '').trim() !== machineCode) {
        return res.json({ success: false, message: '机器码不匹配', points: 0 })
      }

      const { points, matchedRuleKey } = resolvePointsPrice(db, nodeKind, executionTarget, metadata)
      return res.json({
        success: true,
        points,
        matchedRuleKey,
        remainingPoints: Number(lic.points || 0),
      })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误', points: 0 })
    }
  })

  /**
   * POST /confirm — 将 reserve 记为 consume，并累计 total_spent（预扣时已减余额）。
   */
  r.post('/confirm', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      const dedupeKey = String(req.body?.dedupeKey || '').trim()
      if (!key16 || !machineCode || !dedupeKey) {
        return res.json({ success: false, message: '参数无效' })
      }

      const row = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
      if (!row) return res.json({ success: false, message: '授权码不存在' })
      if (String(row.status) !== 'active') return res.json({ success: false, message: '授权不可用' })
      if (String(row.machine_code || '').trim() !== machineCode) {
        return res.json({ success: false, message: '机器码不匹配' })
      }

      const logRow = db.prepare('SELECT * FROM points_log WHERE dedupe_key = ? AND license_code = ?').get(dedupeKey, display)
      if (!logRow) return res.json({ success: false, message: '未找到预扣流水' })
      if (logRow.type === 'consume') {
        return res.json({ success: true, remainingPoints: Number(row.points || 0), idempotent: true })
      }
      if (logRow.type !== 'reserve') {
        return res.json({ success: false, message: '当前流水不可确认' })
      }

      const spentAmt = Math.abs(Number(logRow.amount || 0))
      const tx = db.transaction(() => {
        const cur = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
        const ts = Number(cur.total_spent || 0) + spentAmt
        db.prepare(`UPDATE licenses SET total_spent = ? WHERE code = ?`).run(ts, display)
        db.prepare(`UPDATE points_log SET type = 'consume' WHERE id = ?`).run(logRow.id)
        return Number(cur.points || 0)
      })
      const remaining = tx()
      return res.json({ success: true, remainingPoints: remaining })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误' })
    }
  })

  /**
   * POST /cancel — 释放预扣：退回余额，流水标记取消并释放 dedupe_key 占用。
   */
  r.post('/cancel', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      const dedupeKey = String(req.body?.dedupeKey || '').trim()
      const cancelReasonRaw = String(req.body?.cancelReason || 'user').trim().toLowerCase()
      const isFailureRefund =
        cancelReasonRaw === 'failure' || cancelReasonRaw === 'fail' || cancelReasonRaw === 'task_fail'
      const errorText = String(req.body?.error || req.body?.errorMessage || '').slice(0, 2000)
      const extraMeta = req.body?.metadata
      if (!key16 || !machineCode || !dedupeKey) {
        return res.json({ success: false, message: '参数无效' })
      }

      const lic = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
      if (!lic) return res.json({ success: false, message: '授权码不存在' })
      if (String(lic.status) !== 'active') return res.json({ success: false, message: '授权不可用' })
      if (String(lic.machine_code || '').trim() !== machineCode) {
        return res.json({ success: false, message: '机器码不匹配' })
      }

      const logRow = db.prepare('SELECT * FROM points_log WHERE dedupe_key = ? AND license_code = ?').get(dedupeKey, display)
      if (!logRow) return res.json({ success: true, remainingPoints: Number(lic.points || 0), idempotent: true })
      if (logRow.type === 'consume') {
        return res.json({ success: true, remainingPoints: Number(lic.points || 0), idempotent: true })
      }
      if (logRow.type === 'cancelled' || logRow.type === 'refund') {
        return res.json({ success: true, remainingPoints: Number(lic.points || 0), idempotent: true })
      }
      if (logRow.type !== 'reserve') {
        return res.json({ success: false, message: '当前流水不可取消' })
      }

      const refund = Math.abs(Number(logRow.amount || 0))
      const nextType = isFailureRefund ? 'refund' : 'cancelled'
      const tag = isFailureRefund ? ' [refund:任务失败]' : ' [cancelled]'
      const metaPatch =
        isFailureRefund
          ? {
              error: errorText || undefined,
              failureRefund: true,
              ...(extraMeta && typeof extraMeta === 'object' && !Array.isArray(extraMeta) ? extraMeta : {}),
            }
          : {
              userCancelled: true,
              ...(extraMeta && typeof extraMeta === 'object' && !Array.isArray(extraMeta) ? extraMeta : {}),
            }
      const mergedMeta = mergeMetaJson(logRow.meta_json, metaPatch)
      /** 失败退款流水展示为正数变动；用户主动取消保持原预扣负数 */
      const nextAmount = isFailureRefund ? refund : Number(logRow.amount || 0)
      const tx = db.transaction(() => {
        const cur = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
        const pts = Number(cur.points || 0)
        const after = pts + refund
        db.prepare(`UPDATE licenses SET points = ? WHERE code = ?`).run(after, display)
        const newKey = `${dedupeKey}:void:${logRow.id}`
        db.prepare(
          `UPDATE points_log SET type = ?, dedupe_key = ?, amount = ?, description = coalesce(description,'') || ?, meta_json = ? WHERE id = ?`,
        ).run(nextType, newKey, nextAmount, tag, mergedMeta, logRow.id)
        return after
      })
      const remaining = tx()
      return res.json({ success: true, remainingPoints: remaining, ledgerType: nextType })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误' })
    }
  })

  /**
   * POST /confirm-failure — 任务已成功但 confirm 仍失败时写入死信表（不改余额；流水须仍为 reserve 供人工补 confirm）。
   */
  r.post('/confirm-failure', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      const dedupeKey = String(req.body?.dedupeKey || '').trim()
      const errorText = String(req.body?.errorText || req.body?.message || '').slice(0, 2000)
      const metadata = req.body?.metadata
      if (!key16 || !machineCode || !dedupeKey) {
        return res.json({ success: false, message: '参数无效' })
      }
      const lic = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
      if (!lic) return res.json({ success: false, message: '授权码不存在' })
      if (String(lic.machine_code || '').trim() !== machineCode) {
        return res.json({ success: false, message: '机器码不匹配' })
      }
      const logRow = db.prepare('SELECT * FROM points_log WHERE dedupe_key = ? AND license_code = ?').get(dedupeKey, display)
      if (!logRow || String(logRow.type) !== 'reserve') {
        return res.json({ success: false, message: '无待确认预扣流水' })
      }
      db.prepare(
        `INSERT INTO points_confirm_failures (license_code, machine_code, dedupe_key, error_text, meta_json, status, retry_count)
         VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
      ).run(display, machineCode, dedupeKey, errorText, safeJsonStringify(metadata))
      return res.json({ success: true })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误' })
    }
  })

  /**
   * POST /consume — 单次扣减；可选 dedupeKey + metadata 幂等。
   */
  r.post('/consume', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      const amount = Math.trunc(Number(req.body?.amount))
      const description = String(req.body?.description || '').slice(0, 500)
      const dedupeKey = String(req.body?.dedupeKey || '').trim()
      const metaJson = req.body?.meta_json != null ? safeJsonStringify(req.body?.meta_json) : safeJsonStringify(req.body?.metadata)
      if (!key16 || !machineCode || !Number.isFinite(amount) || amount <= 0) {
        return res.json({ success: false, message: '参数无效' })
      }

      if (dedupeKey) {
        const ex = db.prepare(`SELECT id, type, after_points FROM points_log WHERE dedupe_key = ?`).get(dedupeKey)
        if (ex?.type === 'consume') {
          const row = db.prepare('SELECT points FROM licenses WHERE code = ?').get(display)
          return res.json({
            success: true,
            remainingPoints: Number(row?.points || 0),
            idempotent: true,
          })
        }
      }

      const tx = db.transaction(() => {
        const row = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
        if (!row) throw new Error('not_found')
        if (String(row.status) !== 'active') throw new Error('inactive')
        if (String(row.machine_code || '').trim() !== machineCode) throw new Error('machine')
        const pts = Number(row.points || 0)
        if (pts < amount) throw new Error('insufficient')
        const after = pts - amount
        const ts = Number(row.total_spent || 0) + amount
        db.prepare(`UPDATE licenses SET points = ?, total_spent = ? WHERE code = ?`).run(after, ts, display)
        const dk = dedupeKey || null
        const mj = dedupeKey ? metaJson : null
        db.prepare(
          `INSERT INTO points_log (license_code, amount, type, description, before_points, after_points, dedupe_key, meta_json)
           VALUES (?, ?, 'consume', ?, ?, ?, ?, ?)`,
        ).run(display, -amount, description, pts, after, dk, mj)
        return after
      })

      const remaining = tx()
      return res.json({ success: true, remainingPoints: remaining })
    } catch (e) {
      const m = String(e?.message || e)
      if (m === 'not_found') return res.json({ success: false, message: '授权码不存在' })
      if (m === 'inactive') return res.json({ success: false, message: '授权不可用' })
      if (m === 'machine') return res.json({ success: false, message: '机器码不匹配' })
      if (m === 'insufficient') return res.json({ success: false, message: '积分不足' })
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误' })
    }
  })

  /**
   * POST /recharge — 生产环境请设置 ADMIN_TOKEN 并在请求头携带 x-admin-token。
   */
  r.post('/recharge', (req, res) => {
    try {
      if (!requireAdmin(req)) {
        return res.status(403).json({ success: false, message: '需要管理员令牌' })
      }
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const amount = Math.trunc(Number(req.body?.amount))
      const description = String(req.body?.description || '').slice(0, 500)
      if (!key16 || !Number.isFinite(amount) || amount <= 0) {
        return res.json({ success: false, message: '参数无效' })
      }

      const r0 = applyPointsRecharge(db, {
        licenseCode: String(req.body?.licenseCode || ''),
        amount,
        description,
      })
      if (!r0.ok) {
        if (r0.error === 'not_found') return res.json({ success: false, message: '授权码不存在' })
        if (r0.error === 'inactive') return res.json({ success: false, message: '授权不可用' })
        return res.json({ success: false, message: '参数无效' })
      }
      return res.json({ success: true, newBalance: r0.newBalance })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误' })
    }
  })

  /**
   * POST /balance
   */
  r.post('/balance', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      if (!key16 || !machineCode) {
        return res.json({ success: false, points: 0, expireTime: null, message: '缺少参数' })
      }
      const row = db.prepare('SELECT points, expire_time, machine_code, status FROM licenses WHERE code = ?').get(display)
      if (!row) return res.json({ success: false, points: 0, expireTime: null, message: '授权码不存在' })
      if (String(row.status) !== 'active') {
        return res.json({
          success: false,
          points: Number(row.points || 0),
          expireTime: row.expire_time || null,
          message: '授权不可用',
        })
      }
      if (String(row.machine_code || '').trim() !== machineCode) {
        return res.json({ success: false, points: 0, expireTime: null, message: '机器码不匹配' })
      }
      return res.json({
        success: true,
        points: Number(row.points || 0),
        expireTime: row.expire_time ? String(row.expire_time) : null,
      })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ success: false, points: 0, expireTime: null, message: '服务器错误' })
    }
  })

  /**
   * GET /balance-alert?licenseCode=&machineCode=&threshold=100
   */
  r.get('/balance-alert', (req, res) => {
    try {
      const threshold = Math.max(0, Math.trunc(Number(req.query?.threshold) || 100))
      const key16 = normalizeLicenseKey(String(req.query?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.query?.machineCode || ''))
      if (!key16 || !machineCode) {
        return res.status(400).json({
          belowThreshold: false,
          points: 0,
          threshold,
          message: '缺少 licenseCode 或 machineCode',
        })
      }
      const row = db.prepare('SELECT points, machine_code, status FROM licenses WHERE code = ?').get(display)
      if (!row) {
        return res.status(404).json({ belowThreshold: false, points: 0, threshold, message: '授权码不存在' })
      }
      if (String(row.status) !== 'active') {
        return res.json({
          belowThreshold: false,
          points: Number(row.points || 0),
          threshold,
          message: '授权不可用',
        })
      }
      if (String(row.machine_code || '').trim() !== machineCode) {
        return res.status(403).json({
          belowThreshold: false,
          points: 0,
          threshold,
          message: '机器码不匹配',
        })
      }
      const pts = Number(row.points || 0)
      return res.json({ belowThreshold: pts < threshold, points: pts, threshold })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ belowThreshold: false, points: 0, threshold: 100, message: '服务器错误' })
    }
  })

  /**
   * GET /failures — 任务失败自动退款（type=refund）流水，供用户自助排查。
   */
  r.get('/failures', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.query?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.query?.machineCode || ''))
      if (!key16 || !machineCode) {
        return res.status(400).json({ success: false, message: '缺少 licenseCode 或 machineCode', failures: [] })
      }
      const row = db.prepare('SELECT points, machine_code, status FROM licenses WHERE code = ?').get(display)
      if (!row) return res.status(404).json({ success: false, message: '授权码不存在', failures: [] })
      if (String(row.status) !== 'active') {
        return res.json({ success: false, message: '授权不可用', failures: [] })
      }
      if (String(row.machine_code || '').trim() !== machineCode) {
        return res.status(403).json({ success: false, message: '机器码不匹配', failures: [] })
      }
      const failures = db
        .prepare(
          `SELECT id, created_at, amount, meta_json, dedupe_key
           FROM points_log WHERE license_code = ? AND type = 'refund' ORDER BY id DESC LIMIT 200`,
        )
        .all(display)
      return res.json({ success: true, failures })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ success: false, message: '服务器错误', failures: [] })
    }
  })

  /**
   * POST /logs
   */
  r.post('/logs', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const page = Math.max(1, Math.trunc(Number(req.body?.page) || 1))
      const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(req.body?.pageSize) || 20)))
      if (!key16) return res.json({ logs: [], total: 0 })

      // 含 reserve：任务成功后客户端会 confirm 记为 consume；若刷新发生在 confirm 前，列表里仍应有「预扣」行，避免「扣了分却看不到流水」
      const ledgerTypes = "('consume','recharge','cancelled','refund','reserve')"
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM points_log WHERE license_code = ? AND type IN ${ledgerTypes}`)
        .get(display)
      const total = Number(totalRow?.c || 0)
      const offset = (page - 1) * pageSize
      const logs = db
        .prepare(
          `SELECT id, license_code, amount, type, description, before_points, after_points, created_at, dedupe_key, meta_json
           FROM points_log WHERE license_code = ? AND type IN ${ledgerTypes} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(display, pageSize, offset)
      return res.json({ logs, total })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ logs: [], total: 0 })
    }
  })

  return r
}
