/**
 * 「无限扩图」类工作流：从提示词正文解析四向扩图像素，并写入 Comfy `ImagePadForOutpaint` 上游整数节点。
 */

/** 四向扩图像素（Comfy ImagePadForOutpaint：left / top / right / bottom） */
export type OutpaintPadPx = {
  left: number
  right: number
  top: number
  bottom: number
}

/** 云端「(图生图)-无限扩图」模板默认边距 */
export const FLOWID_OUTPAINT_DEFAULT_PAD: OutpaintPadPx = {
  left: 400,
  right: 400,
  top: 0,
  bottom: 0,
}

const MAX_PAD_PX = 2048

/**
 * @param n 像素
 */
export function clampOutpaintPadPx(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(MAX_PAD_PX, Math.round(n)))
}

/**
 * 工作流名称是否属于无限扩图类。
 */
export function workflowNameSuggestsInfiniteOutpaint(workflowName: string): boolean {
  const name = String(workflowName || '').trim()
  if (!name) return false
  return /无限扩图|向外扩图|outpaint/i.test(name)
}

/**
 * 是否展示底部「扩图：左/上/右/下」输入（名称或 JSON 含 ImagePadForOutpaint）。
 */
export function workflowSupportsOutpaintPadControls(
  workflowJsonText: string,
  workflowName?: string,
): boolean {
  if (workflowNameSuggestsInfiniteOutpaint(workflowName || '')) return true
  return /ImagePadForOutpaint/i.test(String(workflowJsonText || ''))
}

/** @deprecated 使用 {@link workflowSupportsOutpaintPadControls} */
export const workflowSupportsOutpaintPadFromPrompt = workflowSupportsOutpaintPadControls

/** 节点上保存的四向扩图边距（像素） */
export type OutpaintPadNodeFields = {
  comfyOutpaintLeft?: number
  comfyOutpaintTop?: number
  comfyOutpaintRight?: number
  comfyOutpaintBottom?: number
}

/**
 * 从节点字段读取扩图边距；未填写的方向使用工作流默认。
 */
export function resolveOutpaintPadsFromNode(data: OutpaintPadNodeFields): OutpaintPadPx {
  const pick = (v: number | undefined, fallback: number) =>
    clampOutpaintPadPx(typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    left: pick(data.comfyOutpaintLeft, FLOWID_OUTPAINT_DEFAULT_PAD.left),
    top: pick(data.comfyOutpaintTop, FLOWID_OUTPAINT_DEFAULT_PAD.top),
    right: pick(data.comfyOutpaintRight, FLOWID_OUTPAINT_DEFAULT_PAD.right),
    bottom: pick(data.comfyOutpaintBottom, FLOWID_OUTPAINT_DEFAULT_PAD.bottom),
  }
}

type Side = keyof OutpaintPadPx

type MatchedRange = { start: number; end: number }

/**
 * 从提示词中抽取扩图指令，并返回去掉指令后的正文（供 Qwen 编辑等节点使用）。
 *
 * 支持示例：
 * - `宽200` / `宽度+200` / `宽扩200px` → 左右合计 200（各一半）
 * - `高100` / `高度扩大100` → 上下合计 100
 * - `左400 右400 上0 下0`
 * - `左右各200` / `上下各100`
 * - `width 200 height 100`
 */
export function parseOutpaintPadFromPrompt(
  raw: string,
  options?: { defaults?: OutpaintPadPx },
): { pads: OutpaintPadPx; cleanedPrompt: string; hadDirectives: boolean } {
  const defaults = options?.defaults ?? FLOWID_OUTPAINT_DEFAULT_PAD
  const text = String(raw || '')
  const partial: Partial<Record<Side, number>> = {}
  let widthTotal: number | undefined
  let heightTotal: number | undefined
  const ranges: MatchedRange[] = []

  const num = '(\\d{1,4})'
  const pxSuffix = '(?:\\s*(?:px|像素))?'

  const scan = (re: RegExp, onMatch: (n: number) => void) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length })
      onMatch(clampOutpaintPadPx(Number(m[1])))
    }
  }

  scan(new RegExp(`(?:^|[\\s，,;；])左\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    partial.left = n
  })
  scan(new RegExp(`(?:^|[\\s，,;；])右\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    partial.right = n
  })
  scan(new RegExp(`(?:^|[\\s，,;；])上\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    partial.top = n
  })
  scan(new RegExp(`(?:^|[\\s，,;；])下\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    partial.bottom = n
  })
  scan(new RegExp(`(?:^|[\\s，,;；])左右\\s*(?:各)?\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    partial.left = n
    partial.right = n
  })
  scan(new RegExp(`(?:^|[\\s，,;；])上下\\s*(?:各)?\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    partial.top = n
    partial.bottom = n
  })
  scan(
    new RegExp(`(?:^|[\\s，,;；])(?:宽度?|宽|w)\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'),
    (n) => {
      widthTotal = n
    },
  )
  scan(
    new RegExp(`(?:^|[\\s，,;；])(?:高度?|高|h)\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'),
    (n) => {
      heightTotal = n
    },
  )
  scan(new RegExp(`(?:^|[\\s，,;；])width\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    widthTotal = n
  })
  scan(new RegExp(`(?:^|[\\s，,;；])height\\s*[：:+＋]?\\s*${num}${pxSuffix}`, 'giu'), (n) => {
    heightTotal = n
  })

  if (ranges.length === 0) {
    return { pads: { ...defaults }, cleanedPrompt: text.trim(), hadDirectives: false }
  }

  const pads: OutpaintPadPx = { ...defaults }

  if (widthTotal != null) {
    pads.left = Math.floor(widthTotal / 2)
    pads.right = widthTotal - pads.left
  }
  if (heightTotal != null) {
    pads.top = Math.floor(heightTotal / 2)
    pads.bottom = heightTotal - pads.top
  }

  if (partial.left != null) pads.left = partial.left
  if (partial.right != null) pads.right = partial.right
  if (partial.top != null) pads.top = partial.top
  if (partial.bottom != null) pads.bottom = partial.bottom

  const sorted = [...ranges].sort((a, b) => b.start - a.start)
  let cleaned = text
  for (const r of sorted) {
    cleaned = cleaned.slice(0, r.start) + ' ' + cleaned.slice(r.end)
  }
  cleaned = cleaned
    .replace(/[ \t]+$/gm, '')
    .replace(/^\s*[\r\n]+/gm, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { pads, cleanedPrompt: cleaned, hadDirectives: true }
}

function isComfyIntConstantNode(classType: string): boolean {
  const c = String(classType || '').trim().toLowerCase()
  return c === 'easy int' || c === 'intconstant' || c === 'primitiveint'
}

/**
 * 将四向边距写入所有 `ImagePadForOutpaint` 所链接的整数常量节点。
 */
export function injectOutpaintPadsIntoComfyPrompt(
  prompt: Record<string, unknown>,
  pads: OutpaintPadPx,
): Record<string, unknown> {
  const cloned = structuredClone(prompt) as Record<string, unknown>
  const padKeys: Side[] = ['left', 'top', 'right', 'bottom']

  const writeIntNode = (nodeId: string, value: number) => {
    const node = cloned[nodeId]
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const rec = node as Record<string, unknown>
    if (!isComfyIntConstantNode(String(rec.class_type || ''))) return
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return
    ;(inputs as Record<string, unknown>).value = clampOutpaintPadPx(value)
  }

  for (const raw of Object.values(cloned)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    if (!String(rec.class_type || '').includes('ImagePadForOutpaint')) continue
    const inputs = rec.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const inp = inputs as Record<string, unknown>
    for (const key of padKeys) {
      const link = inp[key]
      if (!Array.isArray(link) || link.length < 1) continue
      const srcId = String(link[0] ?? '').trim()
      if (!srcId) continue
      writeIntNode(srcId, pads[key])
    }
  }
  return cloned
}

/**
 * 提示词框占位说明（无限扩图工作流）。
 */
export function outpaintPromptInputHint(): string {
  return '在上方「扩图」行填写左/上/右/下像素（默认左右 400、上下 0）；下方仅写画面延伸描述。'
}
