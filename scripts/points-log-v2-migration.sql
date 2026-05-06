-- FlowID 积分流水 A 方案：结构化 metadata + 幂等键（与 src/backend/db/sqlite.js migratePointsLogV2 等价）
-- 若仅手动修库，可在 SQLite 客户端对 DB_PATH 指向的库执行以下语句。

ALTER TABLE points_log ADD COLUMN dedupe_key TEXT;
ALTER TABLE points_log ADD COLUMN meta_json TEXT;

-- 若列已存在会报错，可逐条执行并忽略重复列错误。

CREATE UNIQUE INDEX IF NOT EXISTS idx_points_log_dedupe
ON points_log(dedupe_key)
WHERE dedupe_key IS NOT NULL AND length(trim(dedupe_key)) > 0;

-- confirm 死信（与 src/backend/db/sqlite.js migratePointsConfirmDlq 一致）
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

-- 若表已存在但无下列列，先逐条执行 ALTER（重复列报错可忽略），再执行文末两行索引。
-- ALTER TABLE points_confirm_failures ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
-- ALTER TABLE points_confirm_failures ADD COLUMN resolved_at TEXT;
-- ALTER TABLE points_confirm_failures ADD COLUMN resolved_by TEXT;
-- ALTER TABLE points_confirm_failures ADD COLUMN ignored_at TEXT;
-- ALTER TABLE points_confirm_failures ADD COLUMN ignored_by TEXT;
-- ALTER TABLE points_confirm_failures ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

-- 确保 resolved_at / ignored_at 列已存在后再执行（与 sqlite.js 迁移末尾一致）：
CREATE INDEX IF NOT EXISTS idx_confirm_fail_resolved_at ON points_confirm_failures(resolved_at);
CREATE INDEX IF NOT EXISTS idx_confirm_fail_ignored_at ON points_confirm_failures(ignored_at);
CREATE INDEX IF NOT EXISTS idx_confirm_fail_retry ON points_confirm_failures(status, retry_count);
