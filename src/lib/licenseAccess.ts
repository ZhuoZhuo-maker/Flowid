export type AccessState = 'unauthorized' | 'valid' | 'expired' | 'tampered_need_verify'

export type LicenseEntitlements = {
  /** 会员模板/预设 */
  proTemplates?: boolean
  /** 允许使用云端模型能力 */
  cloudModels?: boolean
} & Record<string, unknown>

export type LicenseServerConfig = {
  baseUrl: string
  purchaseUrl: string
}

export type LicenseSnapshotV2 = {
  /** 用户输入的授权码 */
  licenseCode: string
  /** 绑定机器码（首次激活时写入；后续校验需一致） */
  machineId: string
  /** 后端下发：到期时间戳（ms） */
  expiresAtMs?: number
  /** 后端下发：权益 */
  entitlements?: LicenseEntitlements

  /**
   * 防改时间：本地时间回拨检测。
   * 每次启动/关键动作都会更新；若检测回拨会进入 tampered_need_verify。
   */
  lastSeenLocalTimeMs?: number

  /**
   * 防改时间：服务器时间锚点（最近一次联网校验成功后刷新）。
   * 用于在离线情况下推断“现在的服务器时间”大致是多少，从而尽量不被本地时钟影响。
   */
  serverAnchor?: {
    serverTimeMs: number
    localTimeMs: number
    updatedAtMs: number
  }

  /** 最近一次联网校验的时间（本地） */
  lastVerifiedAtMs?: number
}

const SNAPSHOT_KEY = 'flowid.license.snapshot.v2'
const SERVER_CONFIG_KEY = 'flowid.license.server.config.v1'

const DEFAULT_SERVER_CONFIG: LicenseServerConfig = {
  baseUrl: 'http://127.0.0.1:3721',
  purchaseUrl: 'https://example.com/buy',
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadLicenseServerConfig(): LicenseServerConfig {
  try {
    const raw = localStorage.getItem(SERVER_CONFIG_KEY)
    if (!raw) return DEFAULT_SERVER_CONFIG
    const parsed = safeJsonParse<Partial<LicenseServerConfig>>(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SERVER_CONFIG
    return {
      baseUrl: String(parsed.baseUrl || DEFAULT_SERVER_CONFIG.baseUrl).trim(),
      purchaseUrl: String(parsed.purchaseUrl || DEFAULT_SERVER_CONFIG.purchaseUrl).trim(),
    }
  } catch {
    return DEFAULT_SERVER_CONFIG
  }
}

export function saveLicenseServerConfig(patch: Partial<LicenseServerConfig>): LicenseServerConfig {
  const prev = loadLicenseServerConfig()
  const next: LicenseServerConfig = {
    baseUrl: String(patch.baseUrl ?? prev.baseUrl).trim(),
    purchaseUrl: String(patch.purchaseUrl ?? prev.purchaseUrl).trim(),
  }
  localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('flowid:license-changed'))
  return next
}

export function loadLicenseSnapshotV2(): LicenseSnapshotV2 | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = safeJsonParse<unknown>(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const row = parsed as Record<string, unknown>
    const licenseCode = String(row.licenseCode || '').trim()
    const machineId = String(row.machineId || '').trim()
    if (!licenseCode || !machineId) return null
    const expiresAtMs = Number.isFinite(Number(row.expiresAtMs)) ? Number(row.expiresAtMs) : undefined
    const entitlements =
      row.entitlements && typeof row.entitlements === 'object' && !Array.isArray(row.entitlements)
        ? (row.entitlements as LicenseEntitlements)
        : undefined
    const lastSeenLocalTimeMs = Number.isFinite(Number(row.lastSeenLocalTimeMs))
      ? Number(row.lastSeenLocalTimeMs)
      : undefined
    const lastVerifiedAtMs = Number.isFinite(Number(row.lastVerifiedAtMs)) ? Number(row.lastVerifiedAtMs) : undefined
    const serverAnchorRaw = row.serverAnchor
    const serverAnchor =
      serverAnchorRaw && typeof serverAnchorRaw === 'object' && !Array.isArray(serverAnchorRaw)
        ? {
            serverTimeMs: Number((serverAnchorRaw as Record<string, unknown>).serverTimeMs || 0),
            localTimeMs: Number((serverAnchorRaw as Record<string, unknown>).localTimeMs || 0),
            updatedAtMs: Number((serverAnchorRaw as Record<string, unknown>).updatedAtMs || 0),
          }
        : undefined
    return {
      licenseCode,
      machineId,
      expiresAtMs,
      entitlements,
      lastSeenLocalTimeMs,
      serverAnchor:
        serverAnchor &&
        Number.isFinite(serverAnchor.serverTimeMs) &&
        Number.isFinite(serverAnchor.localTimeMs) &&
        Number.isFinite(serverAnchor.updatedAtMs)
          ? serverAnchor
          : undefined,
      lastVerifiedAtMs,
    }
  } catch {
    return null
  }
}

export function saveLicenseSnapshotV2(snapshot: LicenseSnapshotV2 | null): void {
  try {
    if (!snapshot) {
      localStorage.removeItem(SNAPSHOT_KEY)
      window.dispatchEvent(new CustomEvent('flowid:license-changed'))
      return
    }
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
    window.dispatchEvent(new CustomEvent('flowid:license-changed'))
  } catch {
    // ignore
  }
}

export type LicenseTamperCheckResult =
  | { ok: true; snapshot: LicenseSnapshotV2 | null }
  | { ok: false; snapshot: LicenseSnapshotV2 | null; reason: 'time_rollback_detected' }

/**
 * 更新本地时间线索，用于离线回拨检测。
 * - 若检测到明显回拨（超过容忍阈值），返回 ok=false，但仍会写入 lastSeenLocalTimeMs（避免死循环）。
 */
export function touchLicenseLocalTime(
  snapshot: LicenseSnapshotV2 | null,
  opts?: { rollbackToleranceMs?: number },
): LicenseTamperCheckResult {
  const rollbackToleranceMs = Math.max(0, Number(opts?.rollbackToleranceMs ?? 2 * 60 * 1000))
  const now = Date.now()
  if (!snapshot) return { ok: true, snapshot: null }
  const prev = Number(snapshot.lastSeenLocalTimeMs || 0)
  const isRollback = prev > 0 && now + rollbackToleranceMs < prev
  const next: LicenseSnapshotV2 = {
    ...snapshot,
    lastSeenLocalTimeMs: now,
  }
  saveLicenseSnapshotV2(next)
  return isRollback
    ? { ok: false, snapshot: next, reason: 'time_rollback_detected' }
    : { ok: true, snapshot: next }
}

export function estimateServerNowMs(snapshot: LicenseSnapshotV2 | null): number | null {
  const anchor = snapshot?.serverAnchor
  if (!anchor) return null
  const delta = Date.now() - anchor.localTimeMs
  if (!Number.isFinite(delta)) return null
  // delta 允许为负（本地回拨），但这时会在 touchLicenseLocalTime 里被抓到；这里仍保守返回。
  return anchor.serverTimeMs + delta
}

export function computeAccessState(snapshot: LicenseSnapshotV2 | null): AccessState {
  if (!snapshot?.licenseCode) return 'unauthorized'
  // 若本地检测到回拨，调用方应先 touchLicenseLocalTime 再决定，这里仅根据字段做兜底判断。
  const nowServer = estimateServerNowMs(snapshot) ?? Date.now()
  const exp = snapshot.expiresAtMs
  if (Number.isFinite(Number(exp)) && Number(exp) > 0) {
    return nowServer <= Number(exp) ? 'valid' : 'expired'
  }
  // 没有 expiresAtMs：按“需联网校验”处理，避免无限期放行。
  return 'tampered_need_verify'
}

export function hasEntitlement(snapshot: LicenseSnapshotV2 | null, key: keyof LicenseEntitlements): boolean {
  const ent = snapshot?.entitlements
  if (!ent) return false
  const v = (ent as Record<string, unknown>)[String(key)]
  return v === true
}

