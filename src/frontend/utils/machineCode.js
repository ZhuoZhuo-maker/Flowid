/**
 * @fileoverview 与积分 HTTP API 配合使用的「机器码」约定说明。
 *
 * FlowID 桌面端请使用 `src/lib/machineId.ts` 的 `getMachineId()`（MID-* 稳定串），
 * 在调用 `/api/license/verify`、`/api/points/*` 时把返回值作为 `machineCode` 传入。
 *
 * 本文件仅做规范化与文档占位；浏览器内无法读取 CPU/主板序列号，需由 Electron 注入或用户复制。
 */

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeMachineCodeForApi(raw) {
  return String(raw || '').trim()
}

/**
 * 示例（在已拿到 `licenseCode` / `machineCode` 后）：
 *
 * ```ts
 * const base = 'http://127.0.0.1:3721/pts'
 * const { valid, points } = await (await fetch(`${base}/api/license/verify`, {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ licenseCode, machineCode }),
 * })).json()
 * ```
 */
