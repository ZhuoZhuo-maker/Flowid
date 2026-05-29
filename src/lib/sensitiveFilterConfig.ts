/**
 * 敏感词过滤总开关（构建时由 `VITE_FLOWID_SENSITIVE_FILTER` 控制）。
 * - `1` / `true`：开启拦截与替换
 * - `0` / `false`：关闭（默认，本地创作不拦）
 */

let testOverride: boolean | null = null

function parseEnvFlag(raw: unknown): boolean | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!v) return null
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return null
}

/** 是否启用敏感词检测、拦截与自动替换 */
export function isSensitiveFilterEnabled(): boolean {
  if (testOverride !== null) return testOverride
  const parsed = parseEnvFlag(import.meta.env.VITE_FLOWID_SENSITIVE_FILTER)
  return parsed === true
}

/** 仅单元测试：覆盖开关，传 `null` 恢复读环境变量 */
export function __setSensitiveFilterEnabledForTest(enabled: boolean | null): void {
  testOverride = enabled
}
