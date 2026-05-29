/**
 * @fileoverview 机器码规范化（历史积分模块占位；开源版客户端不再调用积分 API）。
 *
 * 桌面端稳定机器标识请使用 `src/lib/machineId.ts` 的 `getMachineId()`。
 */

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeMachineCodeForApi(raw) {
  return String(raw || '').trim()
}
