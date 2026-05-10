/** Qwen Multiangle Camera 等与 Flowid 占位符 `__CAM_H__` / `__CAM_V__` / `__CAM_Z__` 对齐的取值范围 */

export const FLOWID_MULTIANGLE_HV_MIN = -60
export const FLOWID_MULTIANGLE_HV_MAX = 60
export const FLOWID_MULTIANGLE_ZOOM_MIN = 1
export const FLOWID_MULTIANGLE_ZOOM_MAX = 20

export const FLOWID_MULTIANGLE_DEFAULT_H = 20
export const FLOWID_MULTIANGLE_DEFAULT_V = 34
export const FLOWID_MULTIANGLE_DEFAULT_ZOOM = 5

export function clampMultiangleHV(n: unknown, fallback: number): number {
  const raw = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fallback
  return Math.max(FLOWID_MULTIANGLE_HV_MIN, Math.min(FLOWID_MULTIANGLE_HV_MAX, raw))
}

export function clampMultiangleZoom(n: unknown, fallback: number): number {
  const raw = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  const z = Math.max(FLOWID_MULTIANGLE_ZOOM_MIN, Math.min(FLOWID_MULTIANGLE_ZOOM_MAX, raw))
  return Math.round(z * 10) / 10
}
