const STORAGE_KEY = 'flowid.sensitive.filter.enabled.v1'

export const SENSITIVE_FILTER_CHANGED_EVENT = 'flowid:sensitive-filter-changed'

/**
 * 是否对用户输入 / 节点文案做敏感词检测、拦截与替换。
 * - 未写入 localStorage 时：`import.meta.env.DEV` 默认关闭（方便本地调试）；生产构建默认开启。
 * - 单元测试（`MODE === 'test'`）默认开启，保证 `sensitiveWords.test.ts` 行为稳定。
 * - 用户可通过设置面板显式写入 `1` / `0` 覆盖默认值。
 */
export function isSensitiveWordFilterEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === '0') return false
    if (v === '1') return true
  } catch {
    /* ignore */
  }
  if (import.meta.env.MODE === 'test') return true
  if (import.meta.env.DEV) return false
  return true
}

export function setSensitiveWordFilterEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent(SENSITIVE_FILTER_CHANGED_EVENT, { detail: { enabled } }),
    )
  } catch {
    /* ignore */
  }
}
