import type { LicenseStatus } from './license'

export type AuthSession = {
  userId: string
  account: string
  nickname: string
  token: string
  machineCode: string
  licenseStatus: LicenseStatus
  expiresAtMs?: number
}

const AUTH_SESSION_STORAGE_KEY = 'flowid.auth.session.v1'
const AUTH_API_CONFIG_STORAGE_KEY = 'flowid.auth.api.config.v1'

export type AuthApiConfig = {
  baseUrl: string
}

/**
 * 读取本地登录会话。
 */
export function loadAuthSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession
    if (!parsed || typeof parsed !== 'object' || !parsed.userId || !parsed.token) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 保存本地登录会话。
 */
export function saveAuthSession(session: AuthSession): void {
  localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session))
}

/**
 * 清理本地登录会话。
 */
export function clearAuthSession(): void {
  localStorage.removeItem(AUTH_SESSION_STORAGE_KEY)
}

/**
 * 读取认证服务配置。
 */
export function loadAuthApiConfig(): AuthApiConfig {
  try {
    const raw = localStorage.getItem(AUTH_API_CONFIG_STORAGE_KEY)
    if (!raw) return { baseUrl: '' }
    const parsed = JSON.parse(raw) as AuthApiConfig
    if (!parsed || typeof parsed !== 'object') return { baseUrl: '' }
    return { baseUrl: String(parsed.baseUrl || '').trim() }
  } catch {
    return { baseUrl: '' }
  }
}

/**
 * 保存认证服务配置。
 */
export function saveAuthApiConfig(config: AuthApiConfig): void {
  localStorage.setItem(
    AUTH_API_CONFIG_STORAGE_KEY,
    JSON.stringify({
      baseUrl: String(config.baseUrl || '').trim(),
    }),
  )
}

/**
 * 生成当前设备标识（前端轻量版本；后续可由桌面端 native 能力替换）。
 */
export function getMachineCode(): string {
  const base = `${navigator.userAgent}|${navigator.language}|${navigator.platform}`
  let hash = 0
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash << 5) - hash + base.charCodeAt(i)
    hash |= 0
  }
  return `M-${Math.abs(hash)}`
}

/**
 * 带超时的 fetch 请求。
 */
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), Math.max(2000, timeoutMs))
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 真实认证：调用后端登录/注册接口。
 * 接口约定：
 * - POST {baseUrl}/auth/login
 * - POST {baseUrl}/auth/register
 * 请求体：{ account, password, machineCode }
 * 响应体：{ userId, account, nickname, token, licenseStatus, expiresAtMs? }
 */
export async function authenticateRemote(
  baseUrl: string,
  account: string,
  password: string,
  mode: 'login' | 'register',
): Promise<AuthSession> {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmedBase) {
    throw new Error('请先填写认证服务地址')
  }
  const normalized = account.trim()
  if (!normalized) throw new Error('请输入账号')
  if (!password.trim()) throw new Error('请输入密码')
  const machineCode = getMachineCode()
  const endpoint = `${trimmedBase}/auth/${mode === 'login' ? 'login' : 'register'}`
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: normalized,
        password,
        machineCode,
      }),
    },
    20_000,
  )
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const msg = String(json.message || json.error || `${response.status} ${response.statusText}`).trim()
    throw new Error(msg || '认证失败')
  }
  const licenseStatusRaw = String(json.licenseStatus || '').trim() as LicenseStatus
  const licenseStatus: LicenseStatus = (
    licenseStatusRaw === 'active' ||
    licenseStatusRaw === 'expiring_soon' ||
    licenseStatusRaw === 'expired' ||
    licenseStatusRaw === 'frozen'
      ? licenseStatusRaw
      : 'active'
  )
  return {
    userId: String(json.userId || '').trim() || `u-${normalized}`,
    account: String(json.account || normalized).trim() || normalized,
    nickname: String(json.nickname || normalized).trim() || normalized,
    token: String(json.token || '').trim(),
    machineCode,
    licenseStatus,
    expiresAtMs: Number.isFinite(Number(json.expiresAtMs)) ? Number(json.expiresAtMs) : undefined,
  }
}

export type LicenseStatusResponse = {
  userId: string
  account: string
  nickname: string
  machineCode: string
  licenseStatus: LicenseStatus
  expiresAtMs?: number
}

/**
 * 使用本地会话 token 拉取后端实时授权状态。
 */
export async function fetchLicenseStatusRemote(): Promise<LicenseStatusResponse | null> {
  const config = loadAuthApiConfig()
  const session = loadAuthSession()
  if (!config.baseUrl.trim() || !session?.token) return null
  const endpoint = `${config.baseUrl.trim().replace(/\/+$/, '')}/auth/license/status`
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    },
    15_000,
  )
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const msg = String(json.message || json.error || `${response.status} ${response.statusText}`).trim()
    throw new Error(msg || '拉取授权状态失败')
  }
  const rawStatus = String(json.licenseStatus || '').trim() as LicenseStatus
  const status: LicenseStatus = (
    rawStatus === 'active' ||
    rawStatus === 'expiring_soon' ||
    rawStatus === 'expired' ||
    rawStatus === 'frozen'
      ? rawStatus
      : 'active'
  )
  return {
    userId: String(json.userId || session.userId),
    account: String(json.account || session.account),
    nickname: String(json.nickname || session.nickname),
    machineCode: String(json.machineCode || session.machineCode || ''),
    licenseStatus: status,
    expiresAtMs: Number.isFinite(Number(json.expiresAtMs)) ? Number(json.expiresAtMs) : undefined,
  }
}
