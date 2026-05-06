import type { LicensePointsRow, PointsAdjustType, PointsLogRow } from './pointsTypes'

/** 画布任务失败且积分已退回时派发，供全局 Toast 等 UI 订阅 */
export const POINTS_TASK_FAILURE_EVENT = 'flowid:points-task-failure'

export type PointsTaskFailureDetail = {
  /** Toast 展示用主文案（失败原因已按 120 字截断并加省略号，若有全文见 errorFull） */
  message: string
  /** 失败原因全文；仅当原因被截断时由发送方传入，供 Toast「展开」 */
  errorFull?: string
}

export function emitPointsTaskFailure(detail: PointsTaskFailureDetail): void {
  if (typeof window === 'undefined' || !detail?.message) return
  window.dispatchEvent(new CustomEvent(POINTS_TASK_FAILURE_EVENT, { detail }))
}

/** @returns 取消订阅 */
export function subscribePointsTaskFailure(
  handler: (detail: PointsTaskFailureDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const fn = (e: Event) => {
    const d = (e as CustomEvent<PointsTaskFailureDetail>).detail
    if (d && typeof d.message === 'string' && d.message.trim()) handler(d)
  }
  window.addEventListener(POINTS_TASK_FAILURE_EVENT, fn)
  return () => window.removeEventListener(POINTS_TASK_FAILURE_EVENT, fn)
}

export function isPointsDesktopAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.flowidDesktop?.pointsGet)
}

export async function pointsGet(licenseCode: string): Promise<LicensePointsRow | null> {
  const desk = window.flowidDesktop
  if (!desk?.pointsGet) return null
  const code = String(licenseCode || '').trim()
  if (!code) return null
  const res = await desk.pointsGet(code)
  if (!res?.ok) return null
  return (res.row as LicensePointsRow | null) ?? null
}

/** 授权激活/校验成功后调用：在本地 SQLite 绑定 license ↔ machine（不自动改积分）。 */
export async function syncPointsLicenseBinding(snapshot: {
  licenseCode: string
  machineId: string
  expiresAtMs?: number
}): Promise<{ ok: boolean; error?: string }> {
  const desk = window.flowidDesktop
  if (!desk?.pointsBind) return { ok: false, error: 'no_desktop' }
  const exp = Number(snapshot.expiresAtMs)
  const expireTimeIso =
    Number.isFinite(exp) && exp > 0 ? new Date(exp).toISOString() : null
  const r = await desk.pointsBind({
    licenseCode: snapshot.licenseCode.trim(),
    machineCode: snapshot.machineId.trim(),
    expireTimeIso,
  })
  if (!r?.ok) return { ok: false, error: String(r?.error || 'bind_failed') }
  return { ok: true }
}

export async function pointsAdjust(payload: {
  licenseCode: string
  machineCode: string
  amount: number
  type: PointsAdjustType
  description?: string
}): Promise<
  | { ok: true; before_points: number; after_points: number }
  | { ok: false; error: string; before_points?: number }
> {
  const desk = window.flowidDesktop
  if (!desk?.pointsAdjust) return { ok: false, error: 'no_desktop' }
  const r = await desk.pointsAdjust({
    licenseCode: payload.licenseCode.trim(),
    machineCode: payload.machineCode.trim(),
    amount: payload.amount,
    type: payload.type,
    description: payload.description ?? '',
  })
  if (!r?.ok) {
    return {
      ok: false,
      error: String(r?.error || 'adjust_failed'),
      before_points: typeof r?.before_points === 'number' ? r.before_points : undefined,
    }
  }
  return { ok: true, before_points: r.before_points, after_points: r.after_points }
}

export async function pointsLog(licenseCode: string, limit = 100): Promise<PointsLogRow[]> {
  const desk = window.flowidDesktop
  if (!desk?.pointsLog) return []
  const res = await desk.pointsLog({ licenseCode: licenseCode.trim(), limit })
  if (!res?.ok || !Array.isArray(res.rows)) return []
  return res.rows as PointsLogRow[]
}
