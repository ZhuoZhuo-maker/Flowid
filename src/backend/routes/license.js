/**
 * @fileoverview POST /api/license/verify — 校验授权码并绑定机器。
 */
import { Router } from 'express'
import { formatLicenseDisplay, normalizeLicenseKey, normalizeMachineCode } from '../lib/codeNorm.js'

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createLicenseRouter(db) {
  const r = Router()

  /**
   * POST /verify
   * body: { licenseCode, machineCode }
   */
  r.post('/verify', (req, res) => {
    try {
      const key16 = normalizeLicenseKey(String(req.body?.licenseCode || ''))
      const display = formatLicenseDisplay(key16)
      const machineCode = normalizeMachineCode(String(req.body?.machineCode || ''))
      if (!key16 || !machineCode) {
        return res.json({ valid: false, message: '缺少 licenseCode 或 machineCode' })
      }

      const row = db.prepare('SELECT * FROM licenses WHERE code = ?').get(display)
      if (!row) {
        return res.json({ valid: false, message: '授权码不存在' })
      }
      if (String(row.status || '') !== 'active') {
        return res.json({ valid: false, message: '授权码状态不可用' })
      }

      const exp = row.expire_time ? String(row.expire_time) : ''
      if (exp) {
        const t = Date.parse(exp.replace(' ', 'T'))
        if (Number.isFinite(t) && Date.now() > t) {
          return res.json({ valid: false, message: '授权已过期', expireTime: exp })
        }
      }

      const bound = row.machine_code != null ? String(row.machine_code).trim() : ''
      if (!bound) {
        const conflictRow = db
          .prepare(
            `SELECT code, status, expire_time FROM licenses WHERE machine_code = ? AND code != ?`,
          )
          .get(machineCode, display)
        if (conflictRow) {
          const otherSt = String(conflictRow.status || '').trim().toLowerCase()
          const oex = conflictRow.expire_time != null ? String(conflictRow.expire_time).trim() : ''
          let otherExpired = false
          if (oex) {
            const ot = Date.parse(oex.replace(' ', 'T'))
            otherExpired = Number.isFinite(ot) && Date.now() > ot
          }
          const canReleaseMachine = otherSt === 'revoked' || otherExpired
          if (!canReleaseMachine) {
            return res.json({ valid: false, message: '该机器已绑定其他授权码' })
          }
          db.prepare(`UPDATE licenses SET machine_code = NULL, bind_time = NULL WHERE code = ?`).run(
            conflictRow.code,
          )
        }
        db.prepare(
          `UPDATE licenses SET machine_code = ?, bind_time = datetime('now') WHERE code = ?`,
        ).run(machineCode, display)
      } else if (bound !== machineCode) {
        return res.json({ valid: false, message: '已绑定其他机器' })
      }

      const fresh = db.prepare('SELECT points, expire_time FROM licenses WHERE code = ?').get(display)
      return res.json({
        valid: true,
        points: Number(fresh?.points || 0),
        expireTime: fresh?.expire_time ? String(fresh.expire_time) : null,
      })
    } catch (e) {
      console.error(e)
      return res.status(500).json({ valid: false, message: '服务器错误' })
    }
  })

  return r
}
