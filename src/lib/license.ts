/**
 * 授权状态枚举：与后端接口保持一致。
 */
export type LicenseStatus = 'active' | 'expiring_soon' | 'expired' | 'frozen'

export type LocalLicenseSnapshot = {
  status: LicenseStatus
  /** 到期时间戳（毫秒） */
  expiresAtMs?: number
  /** 最近一次提醒时间戳（毫秒） */
  lastNoticeAtMs?: number
}

const LICENSE_STORAGE_KEY = 'flowid.license.snapshot.v1'
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 从本地读取授权快照。
 */
export function loadLocalLicenseSnapshot(): LocalLicenseSnapshot | null {
  try {
    const raw = localStorage.getItem(LICENSE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalLicenseSnapshot
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.status) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 保存授权快照。
 */
export function saveLocalLicenseSnapshot(snapshot: LocalLicenseSnapshot): void {
  localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(snapshot))
}

/**
 * 根据授权状态返回提示文案；返回 null 表示不需要提示。
 * 规则：
 * - expired/frozen：每次启动均提示
 * - expiring_soon：仅在 3 天、1 天阈值时提示一次
 */
export function getLicenseNoticeMessage(snapshot: LocalLicenseSnapshot | null): string | null {
  if (!snapshot) return null
  if (snapshot.status === 'expired') {
    return '您的授权已到期，如需继续使用请续费。当前为只读模式，可查看与导出。'
  }
  if (snapshot.status === 'frozen') {
    return '您的账号已被冻结，请联系管理员处理。当前为只读模式，可查看与导出。'
  }
  if (snapshot.status !== 'expiring_soon') return null
  if (!snapshot.expiresAtMs || !Number.isFinite(snapshot.expiresAtMs)) {
    return '您的授权即将到期，请及时续费。'
  }
  const leftMs = snapshot.expiresAtMs - Date.now()
  const leftDays = Math.ceil(leftMs / DAY_MS)
  if (leftDays > 3) return null

  const lastNotice = snapshot.lastNoticeAtMs ?? 0
  const noticeCooldownMs = leftDays <= 1 ? 12 * 60 * 60 * 1000 : DAY_MS
  if (Date.now() - lastNotice < noticeCooldownMs) return null
  return leftDays <= 1
    ? '您的授权将在 1 天内到期，请尽快续费，避免影响提交执行。'
    : '您的授权将在 3 天内到期，请提前续费。'
}

/**
 * 是否处于只读（不可提交）状态。
 */
export function isLicenseReadOnly(snapshot: LocalLicenseSnapshot | null): boolean {
  return snapshot?.status === 'expired' || snapshot?.status === 'frozen'
}

/**
 * 返回提交拦截文案；null 表示允许提交。
 */
export function getLicenseSubmitBlockMessage(snapshot: LocalLicenseSnapshot | null): string | null {
  if (!snapshot) return null
  if (snapshot.status === 'expired') {
    return '您的授权已到期，如需继续使用请续费。当前为只读模式，可查看与导出，但不可提交执行。'
  }
  if (snapshot.status === 'frozen') {
    return '您的账号已被冻结，请联系管理员处理。当前为只读模式，可查看与导出，但不可提交执行。'
  }
  return null
}
