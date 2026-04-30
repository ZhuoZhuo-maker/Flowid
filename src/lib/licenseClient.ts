import { getMachineId } from './machineId'
import {
  loadLicenseServerConfig,
  type LicenseEntitlements,
  type LicenseSnapshotV2,
} from './licenseAccess'

export type LicenseVerifyResponse = {
  ok: true
  licenseCode: string
  machineId: string
  expiresAtMs: number
  entitlements?: LicenseEntitlements
  serverTimeMs: number
} | {
  ok: false
  message: string
  serverTimeMs?: number
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

export async function activateLicenseRemote(licenseCode: string): Promise<LicenseVerifyResponse> {
  const cfg = loadLicenseServerConfig()
  const base = normalizeBaseUrl(cfg.baseUrl)
  if (!base) return { ok: false, message: '请先填写授权服务地址' }
  const code = String(licenseCode || '').trim()
  if (!code) return { ok: false, message: '请输入授权码' }
  const machineId = await getMachineId()
  const { ok, data, status } = await postJson(`${base}/license/activate`, {
    licenseCode: code,
    machineId,
  })
  const row = asRecord(data)
  if (!ok) return { ok: false, message: String(row.message || `激活失败：HTTP ${status}`), serverTimeMs: Number(row.serverTimeMs || 0) || undefined }
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

export async function verifyLicenseRemote(snapshot: LicenseSnapshotV2): Promise<LicenseVerifyResponse> {
  const cfg = loadLicenseServerConfig()
  const base = normalizeBaseUrl(cfg.baseUrl)
  if (!base) return { ok: false, message: '请先填写授权服务地址' }
  const licenseCode = String(snapshot.licenseCode || '').trim()
  if (!licenseCode) return { ok: false, message: '缺少授权码' }
  const machineId = await getMachineId()
  const { ok, data, status } = await postJson(`${base}/license/verify`, {
    licenseCode,
    machineId,
    // 让后端可以做更强的风控：提示客户端检测到的上次锚点
    client: {
      lastVerifiedAtMs: snapshot.lastVerifiedAtMs,
      serverAnchor: snapshot.serverAnchor,
    },
  })
  const row = asRecord(data)
  if (!ok) return { ok: false, message: String(row.message || `校验失败：HTTP ${status}`), serverTimeMs: Number(row.serverTimeMs || 0) || undefined }
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

