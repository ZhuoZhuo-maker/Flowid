/**
 * 桌面端：用户协议「已同意」记在 localStorage，卸载程序往往不会删 userData。
 * 用当前 exe 的 mtime 作为「安装实例」弱指纹：重装/覆盖安装后 exe 通常变化，则清除同意记录以再次展示协议。
 * Web 端无 flowidDesktop，本模块不生效。
 */
const KEY_ACCEPTED_EXE = 'flowid.userAgreement.acceptedExeMtimeMs'

function hasLegacyAgreementKeys(): boolean {
  try {
    return Boolean(
      localStorage.getItem('flowid.userAgreement.accepted.v2') ||
        localStorage.getItem('flowid.userAgreement.accepted.v1'),
    )
  } catch {
    return false
  }
}

export function syncUserAgreementExeStamp(): void {
  try {
    if (typeof window === 'undefined') return
    const fn = window.flowidDesktop?.getExeMtimeMsSync
    if (typeof fn !== 'function') return
    const cur = Number(fn())
    if (!Number.isFinite(cur) || cur <= 0) return
    const raw = localStorage.getItem(KEY_ACCEPTED_EXE)
    if (raw == null || raw === '') {
      if (hasLegacyAgreementKeys()) {
        localStorage.setItem(KEY_ACCEPTED_EXE, String(cur))
      }
      return
    }
    const prev = Number(raw)
    if (!Number.isFinite(prev)) {
      localStorage.removeItem(KEY_ACCEPTED_EXE)
      return
    }
    if (Math.abs(cur - prev) < 2) return
    localStorage.removeItem('flowid.userAgreement.accepted.v1')
    localStorage.removeItem('flowid.userAgreement.accepted.v2')
    localStorage.removeItem(KEY_ACCEPTED_EXE)
  } catch {
    /* ignore */
  }
}

export function persistUserAgreementExeStamp(): void {
  try {
    if (typeof window === 'undefined') return
    const fn = window.flowidDesktop?.getExeMtimeMsSync
    if (typeof fn !== 'function') return
    const cur = Number(fn())
    if (!Number.isFinite(cur) || cur <= 0) return
    localStorage.setItem(KEY_ACCEPTED_EXE, String(cur))
  } catch {
    /* ignore */
  }
}
