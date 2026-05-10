/**
 * Multiangle 镜头：与 Comfy「Qwen Multiangle Camera」常见预设接近的中文选项；
 * 水平/垂直受 ±60 限制，仅作快捷落点。
 */

export type MultiangleNamedPreset<T extends number> = {
  id: string
  label: string
  value: T
  /** 用于顶部 `<sks> …` 风格预览的英文碎片 */
  promptTag: string
}

export const MULTIANGLE_HORIZONTAL: MultiangleNamedPreset<number>[] = [
  { id: 'h_front', label: '正面视角', value: 0, promptTag: 'front view' },
  { id: 'h_fr', label: '右前方视角', value: 45, promptTag: 'front-right quarter view' },
  { id: 'h_right', label: '右侧视角', value: 60, promptTag: 'right side view' },
  { id: 'h_rr', label: '右后方视角', value: 30, promptTag: 'right-rear quarter view' },
  { id: 'h_back', label: '背面视角', value: -52, promptTag: 'back view' },
  { id: 'h_lr', label: '左后方视角', value: -30, promptTag: 'left-rear quarter view' },
  { id: 'h_left', label: '左侧视角', value: -60, promptTag: 'left side view' },
  { id: 'h_lf', label: '左前方视角', value: -45, promptTag: 'front-left quarter view' },
]

export const MULTIANGLE_VERTICAL: MultiangleNamedPreset<number>[] = [
  { id: 'v_low', label: '仰拍', value: -28, promptTag: 'low angle shot' },
  { id: 'v_eye', label: '平视', value: 0, promptTag: 'eye level shot' },
  { id: 'v_high', label: '高角度', value: 34, promptTag: 'elevated shot' },
  { id: 'v_top', label: '俯拍', value: 48, promptTag: 'top-down view' },
]

export const MULTIANGLE_ZOOM: MultiangleNamedPreset<number>[] = [
  { id: 'z_wide', label: '远景', value: 2.8, promptTag: 'long shot' },
  { id: 'z_mid', label: '中景', value: 5, promptTag: 'medium shot' },
  { id: 'z_close', label: '特写', value: 12, promptTag: 'close-up' },
]

export function pickNearestPreset<T extends number>(
  presets: MultiangleNamedPreset<T>[],
  value: number,
): MultiangleNamedPreset<T> {
  let best = presets[0]!
  let bestD = Math.abs(Number(best.value) - value)
  for (let i = 1; i < presets.length; i++) {
    const p = presets[i]!
    const d = Math.abs(Number(p.value) - value)
    if (d < bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

export function buildMultianglePreviewLine(h: number, v: number, z: number): string {
  const hp = pickNearestPreset(MULTIANGLE_HORIZONTAL, h)
  const vp = pickNearestPreset(MULTIANGLE_VERTICAL, v)
  const zp = pickNearestPreset(MULTIANGLE_ZOOM, z)
  return `<sks> ${hp.promptTag} ${vp.promptTag} ${zp.promptTag}`
}
