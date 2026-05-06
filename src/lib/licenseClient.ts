import { getMachineId } from './machineId'
import {
  loadLicenseServerConfig,
  type LicenseEntitlements,
  type LicenseSnapshotV2,
} from './licenseAccess'
import { apiLicenseVerify } from './licensePointsApi'

export type LicenseVerifyResponse =
  | {
      ok: true
      licenseCode: string
      machineId: string
      expiresAtMs: number
      entitlements?: LicenseEntitlements
      serverTimeMs: number
    }
  | {
      ok: false
      message: string
      serverTimeMs?: number
      /** 校验/激活失败时的 HTTP 状态码（用于区分「服务端拒绝」与网络/5xx） */
      httpStatus?: number
    }

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

async function postJson(url: string, json: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data: data as unknown }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** 积分侧无过期时间时用极大值，便于 computeAccessState 视为有效 */
function expireTimeToExpiresAtMs(expireTime: string | null | undefined): number {
  if (expireTime == null || !String(expireTime).trim()) return Number.MAX_SAFE_INTEGER
  const t = Date.parse(String(expireTime))
  if (!Number.isFinite(t)) return Number.MAX_SAFE_INTEGER
  return t
}

/**
 * 积分校验失败后是否再尝试 Auth（仅兼容旧 JWT 明文码）。
 * 明确为 SQLite 业务失败时不应再调 Auth，避免误报。
 */
function shouldTryAuthAfterPointsFail(message: string): boolean {
  const m = String(message || '')
  if (!m) return true
  /** 积分模块未挂载（503 占位），应再试 Auth，且勿把该文案当「业务拒码」处理 */
  if (m.includes('points_module_unavailable')) return true
  if (m.includes('授权码不存在')) return true
  if (m.includes('缺少 licenseCode') || m.includes('缺少 machineCode')) return false
  if (m.includes('不可用')) return false
  if (m.includes('过期')) return false
  if (m.includes('绑定') || m.includes('机器')) return false
  return false
}

async function activateAuthOnly(licenseCode: string): Promise<LicenseVerifyResponse> {
  const cfg = loadLicenseServerConfig()
  const base = normalizeBaseUrl(cfg.baseUrl)
  if (!base) return { ok: false, message: '请先填写授权服务地址' }
  const code = String(licenseCode || '').trim()
  const machineId = await getMachineId()
  const { ok, data, status } = await postJson(`${base}/license/activate`, {
    licenseCode: code,
    machineId,
  })
  const row = asRecord(data)
  if (!ok)
    return {
      ok: false,
      message: String(row.message || `激活失败：HTTP ${status}`),
      serverTimeMs: Number(row.serverTimeMs || 0) || undefined,
      httpStatus: status,
    }
  const expiresAtMs = Number(row.expiresAtMs || 0)
  const serverTimeMs = Number(row.serverTimeMs || 0)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    return { ok: false, message: '激活失败：后端未返回有效 expiresAtMs' }
  }
  return {
    ok: true,
    licenseCode: String(row.licenseCode || code).trim() || code,
    machineId: String(row.machineId || machineId).trim() || machineId,
    expiresAtMs,
    entitlements:
      row.entitlements && typeof row.entitlements === 'object' && !Array.isArray(row.entitlements)
        ? (row.entitlements as LicenseEntitlements)
        : undefined,
    serverTimeMs: Number.isFinite(serverTimeMs) && serverTimeMs > 0 ? serverTimeMs : Date.now(),
  }
}

/**
 * 激活：优先 **积分 SQLite**（`/pts/api/license/verify`，首次绑定机器），失败时再尝试 Auth JWT `/license/activate`。
 */
export async function activateLicenseRemote(licenseCode: string): Promise<LicenseVerifyResponse> {
  const code = String(licenseCode || '').trim()
  if (!code) return { ok: false, message: '请输入授权码' }
  const machineId = await getMachineId()
  try {
    const pts = await apiLicenseVerify(code, machineId)
    if (pts.valid) {
      return {
        ok: true,
        licenseCode: code,
        machineId,
        expiresAtMs: expireTimeToExpiresAtMs(pts.expireTime),
        serverTimeMs: Date.now(),
      }
    }
    const pm = String(pts.message || '')
    if (shouldTryAuthAfterPointsFail(pm)) {
      return activateAuthOnly(code)
    }
    return { ok: false, message: pm || '激活失败', httpStatus: 400 }
  } catch {
    return activateAuthOnly(code)
  }
}

async function verifyAuthOnly(snapshot: LicenseSnapshotV2): Promise<LicenseVerifyResponse> {
  const cfg = loadLicenseServerConfig()
  const base = normalizeBaseUrl(cfg.baseUrl)
  if (!base) return { ok: false, message: '请先填写授权服务地址' }
  const licenseCode = String(snapshot.licenseCode || '').trim()
  if (!licenseCode) return { ok: false, message: '缺少授权码' }
  const machineId = await getMachineId()
  const { ok, data, status } = await postJson(`${base}/license/verify`, {
    licenseCode,
    machineId,
    client: {
      lastVerifiedAtMs: snapshot.lastVerifiedAtMs,
      serverAnchor: snapshot.serverAnchor,
    },
  })
  const row = asRecord(data)
  if (!ok)
    return {
      ok: false,
      message: String(row.message || `校验失败：HTTP ${status}`),
      serverTimeMs: Number(row.serverTimeMs || 0) || undefined,
      httpStatus: status,
    }
  const expiresAtMs = Number(row.expiresAtMs || 0)
  const serverTimeMs = Number(row.serverTimeMs || 0)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    return { ok: false, message: '校验失败：后端未返回有效 expiresAtMs' }
  }
  return {
    ok: true,
    licenseCode: String(row.licenseCode || licenseCode).trim() || licenseCode,
    machineId: String(row.machineId || machineId).trim() || machineId,
    expiresAtMs,
    entitlements:
      row.entitlements && typeof row.entitlements === 'object' && !Array.isArray(row.entitlements)
        ? (row.entitlements as LicenseEntitlements)
        : undefined,
    serverTimeMs: Number.isFinite(serverTimeMs) && serverTimeMs > 0 ? serverTimeMs : Date.now(),
  }
}

/**
 * 校验：优先 **积分 SQLite** `/pts/api/license/verify`，失败时再尝试 Auth `/license/verify`（旧 JWT）。
 */
export async function verifyLicenseRemote(snapshot: LicenseSnapshotV2): Promise<LicenseVerifyResponse> {
  const licenseCode = String(snapshot.licenseCode || '').trim()
  if (!licenseCode) return { ok: false, message: '缺少授权码' }
  const machineId = await getMachineId()
  try {
    const pts = await apiLicenseVerify(licenseCode, machineId)
    if (pts.valid) {
      return {
        ok: true,
        licenseCode,
        machineId,
        expiresAtMs: expireTimeToExpiresAtMs(pts.expireTime),
        serverTimeMs: Date.now(),
      }
    }
    const pm = String(pts.message || '')
    if (shouldTryAuthAfterPointsFail(pm)) {
      return verifyAuthOnly(snapshot)
    }
    return { ok: false, message: pm || '校验失败', httpStatus: 400 }
  } catch {
    return verifyAuthOnly(snapshot)
  }
}
