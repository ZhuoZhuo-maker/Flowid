/**
 * @fileoverview 积分服务 SQLite：建表、单例连接（better-sqlite3）。
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * @param {string} dbFilePath 绝对或相对 cwd 的数据库文件路径
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(dbFilePath) {
  const resolved = path.isAbsolute(dbFilePath) ? dbFilePath : path.resolve(process.cwd(), dbFilePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const db = new Database(resolved)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS licenses (
  code TEXT PRIMARY KEY,
  machine_code TEXT UNIQUE,
  points INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  bind_time TEXT,
  expire_time TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_code TEXT NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  before_points INTEGER NOT NULL,
  after_points INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (license_code) REFERENCES licenses(code)
);

CREATE INDEX IF NOT EXISTS idx_points_log_license ON points_log(license_code);
CREATE INDEX IF NOT EXISTS idx_points_log_license_id ON points_log(license_code, id);
`)
  migratePointsLogV2(db)
  migratePointsConfirmDlq(db)
  migratePointsPricing(db)
}

/**
 * A 方案：幂等键 + 结构化 metadata（JSON），旧库自动补列。
 * @param {import('better-sqlite3').Database} db
 */
function migratePointsLogV2(db) {
  const cols = db.prepare(`PRAGMA table_info(points_log)`).all()
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('dedupe_key')) {
    db.exec(`ALTER TABLE points_log ADD COLUMN dedupe_key TEXT`)
  }
  if (!names.has('meta_json')) {
    db.exec(`ALTER TABLE points_log ADD COLUMN meta_json TEXT`)
  }
  db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_log_dedupe
ON points_log(dedupe_key)
WHERE dedupe_key IS NOT NULL AND length(trim(dedupe_key)) > 0;
`)
}

/**
 * confirm 多次失败后的死信记录（便于运维补账，不自动改余额）。
 * @param {import('better-sqlite3').Database} db
 */
function migratePointsConfirmDlq(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS points_confirm_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_code TEXT NOT NULL,
  machine_code TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  error_text TEXT,
  meta_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT,
  ignored_at TEXT,
  ignored_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_confirm_fail_license ON points_confirm_failures(license_code);
CREATE INDEX IF NOT EXISTS idx_confirm_fail_dedupe ON points_confirm_failures(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_confirm_fail_status ON points_confirm_failures(status);
`)
  let cols = []
  try {
    cols = db.prepare(`PRAGMA table_info(points_confirm_failures)`).all()
  } catch {
    cols = []
  }
  const names = new Set(cols.map((c) => c.name))
  if (cols.length && !names.has('status')) {
    db.exec(`ALTER TABLE points_confirm_failures ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`)
  }
  if (cols.length && !names.has('resolved_at')) {
    db.exec(`ALTER TABLE points_confirm_failures ADD COLUMN resolved_at TEXT`)
  }
  if (cols.length && !names.has('resolved_by')) {
    db.exec(`ALTER TABLE points_confirm_failures ADD COLUMN resolved_by TEXT`)
  }
  if (cols.length && !names.has('ignored_at')) {
    db.exec(`ALTER TABLE points_confirm_failures ADD COLUMN ignored_at TEXT`)
  }
  if (cols.length && !names.has('ignored_by')) {
    db.exec(`ALTER TABLE points_confirm_failures ADD COLUMN ignored_by TEXT`)
  }
  if (cols.length && !names.has('retry_count')) {
    db.exec(`ALTER TABLE points_confirm_failures ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`)
  }
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_confirm_fail_resolved_at ON points_confirm_failures(resolved_at);
CREATE INDEX IF NOT EXISTS idx_confirm_fail_ignored_at ON points_confirm_failures(ignored_at);
CREATE INDEX IF NOT EXISTS idx_confirm_fail_retry ON points_confirm_failures(status, retry_count);
`)
}

/**
 * 积分单价规则：仅 workflow:名称、model:名称 参与计价（见 points.js resolvePointsPrice）；历史库中可能仍有 base:* 行，已不再读取。
 *
 * 计价键与前端一致：工作流取「当前节点解析出的工作流显示名」做小写+空格转下划线；
 * 云端模型取节点/全局自助预设里的「模型」字符串，同样规则。
 *
 * 试用占位（任选其一改名即可在画布上看到与 base 不同的扣积分）：
 * - 云端 Comfy（走工作流执行、且非本地 Comfy）：把工作流名称设为「Cloud Comfy」→ 命中 workflow:cloud_comfy；
 *   或「FlowID Cloud Comfy Demo」→ workflow:flowid_cloud_comfy_demo；或「占位云端Comfy」→ workflow:占位云端comfy
 * - 云端模型（走模型执行）：把模型名设为「Cloud Model」→ model:cloud_model；
 *   或「FlowID Cloud Model Demo」→ model:flowid_cloud_model_demo；或「占位云端模型」→ model:占位云端模型
 * 管理端可查：GET /pts/api/admin/points-pricing（需 x-admin-token，若已配置）。
 *
 * @param {import('better-sqlite3').Database} db
 */
function migratePointsPricing(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS points_price_rules (
  rule_key TEXT PRIMARY KEY,
  points INTEGER NOT NULL,
  label TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
  const ins = db.prepare(
    `INSERT OR IGNORE INTO points_price_rules (rule_key, points, label) VALUES (?, ?, ?)`,
  )
  /** 新库不再插入 base:* 默认行：计价仅认 workflow: / model:（见 points.js resolvePointsPrice） */
  const defaults = [
    // --- 试用占位：云端 Comfy / 云端模型（名称与 rule_key 对应见文件头注释）---
    ['workflow:cloud_comfy', 15, '试用·云端Comfy：工作流名「Cloud Comfy」'],
    ['workflow:flowid_cloud_comfy_demo', 33, '试用·云端Comfy：工作流名「FlowID Cloud Comfy Demo」'],
    ['workflow:占位云端comfy', 21, '试用·云端Comfy：工作流名「占位云端Comfy」'],
    ['model:cloud_model', 12, '试用·云端模型：模型名「Cloud Model」'],
    ['model:flowid_cloud_model_demo', 22, '试用·云端模型：模型名「FlowID Cloud Model Demo」'],
    ['model:占位云端模型', 19, '试用·云端模型：模型名「占位云端模型」'],
  ]
  for (const row of defaults) {
    ins.run(row[0], row[1], row[2])
  }
}

/** 供测试脚本在内存库上跑迁移（与 openDb 内迁移一致） */
export { migrate as applyFlowidSqliteSchema }
