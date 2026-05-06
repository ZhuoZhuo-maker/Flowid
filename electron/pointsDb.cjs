/**
 * 本地积分 SQLite（sql.js WASM，无需 native 编译），文件位于 userData/flowid-points.sqlite3
 */
const path = require('node:path')
const fs = require('node:fs')

let initSqlJs = null
let SQL = null
let db = null
let dbPath = null

function wasmDistDir() {
  const wasm = require.resolve('sql.js/dist/sql-wasm.wasm')
  return path.dirname(wasm)
}

async function getModule() {
  if (SQL) return SQL
  if (!initSqlJs) {
    initSqlJs = require('sql.js')
  }
  const dist = wasmDistDir()
  SQL = await initSqlJs({
    locateFile: (file) => path.join(dist, file),
  })
  return SQL
}

function migrate() {
  db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS licenses (
  code TEXT PRIMARY KEY,
  machine_code TEXT UNIQUE,
  points INTEGER DEFAULT 0,
  total_earned INTEGER DEFAULT 0,
  total_spent INTEGER DEFAULT 0,
  bind_time TEXT,
  expire_time TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_code TEXT,
  amount INTEGER,
  type TEXT,
  description TEXT,
  before_points INTEGER,
  after_points INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (license_code) REFERENCES licenses(code)
);
CREATE INDEX IF NOT EXISTS idx_points_log_license ON points_log(license_code);
CREATE INDEX IF NOT EXISTS idx_points_log_license_id ON points_log(license_code, id);
`)
}

function persist() {
  if (!db || !dbPath) return
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

async function ensureOpen(userDataPath) {
  if (db) return db
  const Mod = await getModule()
  dbPath = path.join(userDataPath, 'flowid-points.sqlite3')
  let buf
  try {
    buf = new Uint8Array(fs.readFileSync(dbPath))
  } catch {
    buf = undefined
  }
  db = new Mod.Database(buf)
  migrate()
  persist()
  return db
}

function rowToLicense(obj) {
  if (!obj || !obj.code) return null
  return {
    code: String(obj.code),
    machine_code: obj.machine_code != null ? String(obj.machine_code) : null,
    points: Number(obj.points || 0),
    total_earned: Number(obj.total_earned || 0),
    total_spent: Number(obj.total_spent || 0),
    bind_time: obj.bind_time != null ? String(obj.bind_time) : null,
    expire_time: obj.expire_time != null ? String(obj.expire_time) : null,
    status: String(obj.status || 'active'),
    created_at: obj.created_at != null ? String(obj.created_at) : null,
  }
}

function getLicense(code) {
  const stmt = db.prepare('SELECT * FROM licenses WHERE code = ?')
  stmt.bind([code])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const o = stmt.getAsObject()
  stmt.free()
  return rowToLicense(o)
}

/**
 * 绑定或刷新授权码与本机机器码；不修改积分余额。
 * @param {string|null|undefined} expireTimeIso 到期时间 ISO，可为 null
 */
function bindLicense(code, machineCode, expireTimeIso) {
  const c = String(code || '').trim()
  const m = String(machineCode || '').trim()
  if (!c || !m) return { ok: false, error: 'missing_code_or_machine' }

  db.run('BEGIN IMMEDIATE')
  try {
    const existing = getLicense(c)
    if (existing && existing.machine_code && existing.machine_code !== m) {
      db.run('ROLLBACK')
      return { ok: false, error: 'license_machine_mismatch' }
    }

    const conflict = db.prepare('SELECT code FROM licenses WHERE machine_code = ? AND code != ?')
    conflict.bind([m, c])
    if (conflict.step()) {
      conflict.free()
      db.run('ROLLBACK')
      return { ok: false, error: 'machine_already_bound' }
    }
    conflict.free()

    const exp =
      expireTimeIso === undefined || expireTimeIso === null || expireTimeIso === ''
        ? null
        : String(expireTimeIso)

    if (!existing) {
      db.run(
        `INSERT INTO licenses (code, machine_code, points, total_earned, total_spent, bind_time, expire_time, status)
         VALUES (?, ?, 0, 0, 0, datetime('now'), ?, 'active')`,
        [c, m, exp],
      )
    } else {
      db.run(
        `UPDATE licenses SET machine_code = ?, bind_time = datetime('now'),
         expire_time = COALESCE(?, expire_time)
         WHERE code = ?`,
        [m, exp, c],
      )
    }
    db.run('COMMIT')
    persist()
    return { ok: true }
  } catch (e) {
    try {
      db.run('ROLLBACK')
    } catch (_) {
      /* ignore */
    }
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

/**
 * @param {'recharge'|'consume'|'refund'|'gift'} type
 */
function adjustPoints(licenseCode, machineCode, amount, type, description) {
  const code = String(licenseCode || '').trim()
  const mach = String(machineCode || '').trim()
  const amt = Math.trunc(Number(amount))
  const t = String(type || '').trim()
  if (!code || !mach) return { ok: false, error: 'missing_code_or_machine' }
  if (!Number.isFinite(amt) || amt === 0) return { ok: false, error: 'invalid_amount' }
  if (!['recharge', 'consume', 'refund', 'gift'].includes(t)) return { ok: false, error: 'invalid_type' }

  db.run('BEGIN IMMEDIATE')
  try {
    const row = getLicense(code)
    if (!row) {
      db.run('ROLLBACK')
      return { ok: false, error: 'license_not_found' }
    }
    if (row.machine_code !== mach) {
      db.run('ROLLBACK')
      return { ok: false, error: 'machine_mismatch' }
    }
    if (row.status !== 'active') {
      db.run('ROLLBACK')
      return { ok: false, error: 'license_inactive' }
    }

    const before = row.points
    const after = before + amt
    if (after < 0) {
      db.run('ROLLBACK')
      return { ok: false, error: 'insufficient_points', before_points: before }
    }

    let te = row.total_earned
    let ts = row.total_spent
    if (amt > 0) te += amt
    if (amt < 0) ts += -amt

    db.run(
      `UPDATE licenses SET points = ?, total_earned = ?, total_spent = ? WHERE code = ?`,
      [after, te, ts, code],
    )
    db.run(
      `INSERT INTO points_log (license_code, amount, type, description, before_points, after_points)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, amt, t, String(description || '').slice(0, 500), before, after],
    )
    db.run('COMMIT')
    persist()
    return { ok: true, before_points: before, after_points: after }
  } catch (e) {
    try {
      db.run('ROLLBACK')
    } catch (_) {
      /* ignore */
    }
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

function listPointsLog(licenseCode, limit = 100) {
  const code = String(licenseCode || '').trim()
  const lim = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 100)))
  const stmt = db.prepare(
    `SELECT id, license_code, amount, type, description, before_points, after_points, created_at
     FROM points_log WHERE license_code = ? ORDER BY id DESC LIMIT ?`,
  )
  stmt.bind([code, lim])
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

module.exports = {
  ensureOpen,
  getLicense,
  bindLicense,
  adjustPoints,
  listPointsLog,
}
