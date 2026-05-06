-- =============================================================================
-- 历史死信：resolved_at / ignored_at 回填（预览 → 核对 → 执行）
-- 在 SQLite 客户端打开与 Points API 相同的 DB 文件后执行。
-- =============================================================================

-- 1) resolved 但缺少 resolved_at 的候选（含样例字段）
SELECT id,
       status,
       created_at,
       license_code,
       dedupe_key,
       resolved_at AS current_resolved_at,
       resolved_by AS current_resolved_by
FROM points_confirm_failures
WHERE status = 'resolved'
  AND (resolved_at IS NULL OR trim(resolved_at) = '');

-- 2) ignored 但缺少 ignored_at 的候选
SELECT id,
       status,
       created_at,
       license_code,
       dedupe_key,
       ignored_at AS current_ignored_at,
       ignored_by AS current_ignored_by
FROM points_confirm_failures
WHERE status = 'ignored'
  AND (ignored_at IS NULL OR trim(ignored_at) = '');

-- 3) 条数统计（应与上两行结果行数一致）
SELECT
  (SELECT count(*)
   FROM points_confirm_failures
   WHERE status = 'resolved' AND (resolved_at IS NULL OR trim(resolved_at) = '')) AS cnt_resolved_missing_ts,
  (SELECT count(*)
   FROM points_confirm_failures
   WHERE status = 'ignored' AND (ignored_at IS NULL OR trim(ignored_at) = '')) AS cnt_ignored_missing_ts;

-- ========== 执行版（默认注释）：请先备份数据库，确认 1)~3) 后再取消注释执行 ==========
-- UPDATE points_confirm_failures
-- SET resolved_at = created_at,
--     resolved_by = 'backfill'
-- WHERE status = 'resolved'
--   AND (resolved_at IS NULL OR trim(resolved_at) = '');
--
-- UPDATE points_confirm_failures
-- SET ignored_at = created_at,
--     ignored_by = 'backfill'
-- WHERE status = 'ignored'
--   AND (ignored_at IS NULL OR trim(ignored_at) = '');
