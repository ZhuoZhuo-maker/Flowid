/**
 * 调用积分 HTTP 服务：与 Auth 同机时默认 `http://127.0.0.1:3721/pts`（前缀 `/pts`），可通过 `VITE_LICENSE_API_URL` 覆盖。
 */
const baseUrl = (): string => {
  const u = import.meta.env.VITE_LICENSE_API_URL
  return String(u || 'http://127.0.0.1:3721/pts').replace(/\/+$/, '')
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return (await res.json()) as T
}

export type LicenseVerifyApiResponse = {
  valid: boolean
  points?: number
  message?: string
  expireTime?: string | null
}

export async function apiLicenseVerify(licenseCode: string, machineCode: string): Promise<LicenseVerifyApiResponse> {
  return postJson('/api/license/verify', { licenseCode, machineCode })
}

export type PointsConsumeResponse = {
  success: boolean
  remainingPoints?: number
  message?: string
  idempotent?: boolean
}

export async function apiPointsConsume(payload: {
  licenseCode: string
  machineCode: string
  amount: number
  description: string
  dedupeKey?: string
  metadata?: Record<string, unknown>
}): Promise<PointsConsumeResponse> {
  return postJson('/api/points/consume', payload)
}

export type PointsReserveResponse = {
  success: boolean
  remainingPoints?: number
  charged?: number
  message?: string
  /** 与 Auth 会员联动时可能为 `need_pro_membership` */
  error?: string
  idempotent?: boolean
  phase?: string
}

/** 预扣积分（成功路径需再调 apiPointsConfirm；失败需 apiPointsCancel） */
export type PointsQuoteResponse = {
  success: boolean
  points?: number
  matchedRuleKey?: string
  remainingPoints?: number
  message?: string
}

/** POST /api/points/quote — 预估预扣积分（与 reserve 计价一致） */
export async function apiPointsQuote(payload: {
  licenseCode: string
  machineCode: string
  nodeKind: string
  executionTarget: string
  metadata?: { cloudModelName?: string; workflowName?: string; pointsBillingKind?: string }
}): Promise<PointsQuoteResponse> {
  return postJson('/api/points/quote', payload)
}

export async function apiPointsReserve(payload: {
  licenseCode: string
  machineCode: string
  dedupeKey: string
  nodeKind: string
  executionTarget: string
  metadata?: { cloudModelName?: string; workflowName?: string; pointsBillingKind?: string }
  /** 与 SQLite 积分码分离：Auth JWT 明文授权码 + 机器码，用于服务端校验 proTemplates */
  authLicenseCode?: string
  authMachineId?: string
}): Promise<PointsReserveResponse> {
  return postJson('/api/points/reserve', payload)
}

export type PointsConfirmCancelResponse = {
  success: boolean
  remainingPoints?: number
  message?: string
  idempotent?: boolean
  /** 预扣释放后的流水类型（cancel 接口） */
  ledgerType?: string
}

export async function apiPointsConfirm(payload: {
  licenseCode: string
  machineCode: string
  dedupeKey: string
}): Promise<PointsConfirmCancelResponse> {
  return postJson('/api/points/confirm', payload)
}

export async function apiPointsCancel(payload: {
  licenseCode: string
  machineCode: string
  dedupeKey: string
  /** 默认 user：主动取消 → cancelled；failure：任务失败自动退款 → refund */
  cancelReason?: 'user' | 'failure'
  error?: string
  metadata?: Record<string, unknown>
}): Promise<PointsConfirmCancelResponse> {
  return postJson('/api/points/cancel', payload)
}

/** 多次 confirm 仍失败时落库死信（不改变积分余额） */
export async function apiPointsConfirmFailure(payload: {
  licenseCode: string
  machineCode: string
  dedupeKey: string
  errorText: string
  metadata?: Record<string, unknown>
}): Promise<{ success: boolean; message?: string }> {
  return postJson('/api/points/confirm-failure', payload)
}

export type PointsRechargeResponse = { success: boolean; newBalance?: number; message?: string }

export async function apiPointsRecharge(
  payload: { licenseCode: string; amount: number; description: string },
  adminToken: string,
): Promise<PointsRechargeResponse> {
  const res = await fetch(`${baseUrl()}/api/points/recharge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken,
    },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as PointsRechargeResponse
}

export type PointsBalanceResponse = {
  success: boolean
  points: number
  expireTime: string | null
  message?: string
}

export async function apiPointsBalance(licenseCode: string, machineCode: string): Promise<PointsBalanceResponse> {
  return postJson('/api/points/balance', { licenseCode, machineCode })
}

export type PointsBalanceAlertResponse = {
  belowThreshold: boolean
  points: number
  threshold: number
  message?: string
}

/** GET /api/points/balance-alert — 低余额提示（需 license + machine 校验） */
export async function apiPointsBalanceAlert(
  licenseCode: string,
  machineCode: string,
  threshold = 100,
): Promise<PointsBalanceAlertResponse> {
  const q = new URLSearchParams({
    licenseCode,
    machineCode,
    threshold: String(threshold),
  })
  const res = await fetch(`${baseUrl()}/api/points/balance-alert?${q}`)
  const j = (await res.json().catch(() => ({}))) as PointsBalanceAlertResponse
  if (!res.ok) {
    return {
      belowThreshold: false,
      points: 0,
      threshold,
      message: typeof j?.message === 'string' ? j.message : res.statusText,
    }
  }
  return j
}

export type PointsLogRow = {
  id: number
  license_code: string
  amount: number
  type: string
  description: string
  before_points: number
  after_points: number
  created_at: string
  dedupe_key?: string | null
  meta_json?: string | null
}

export async function apiPointsLogs(
  licenseCode: string,
  page = 1,
  pageSize = 20,
): Promise<{ logs: PointsLogRow[]; total: number }> {
  return postJson('/api/points/logs', { licenseCode, page, pageSize })
}

export type PointsFailureRow = {
  id: number
  created_at: string
  amount: number
  meta_json: string | null
  dedupe_key: string | null
}

/** GET /api/points/failures — 失败自动退款流水 */
export async function apiPointsFailures(
  licenseCode: string,
  machineCode: string,
): Promise<{ success: boolean; failures?: PointsFailureRow[]; message?: string }> {
  const q = new URLSearchParams({ licenseCode, machineCode })
  const res = await fetch(`${baseUrl()}/api/points/failures?${q}`)
  const j = (await res.json().catch(() => ({}))) as {
    success?: boolean
    failures?: PointsFailureRow[]
    message?: string
  }
  if (!res.ok) {
    return {
      success: false,
      failures: [],
      message: typeof j?.message === 'string' ? j.message : res.statusText,
    }
  }
  return {
    success: Boolean(j.success),
    failures: Array.isArray(j.failures) ? j.failures : [],
    message: typeof j?.message === 'string' ? j.message : undefined,
  }
}
