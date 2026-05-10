import type { Node } from '@xyflow/react'
import type { ImageNodeData, PanoramaNodeData, StudioNodeData } from '../types'

/**
 * 兼容旧数据：无节点 id 时的 @ 写法（不推荐，仅标题全等 + 图-n 简写）。
 * 新插入统一用 `@[标题](节点uuid)`，解析以 id 为准，不猜节点。
 */
export const NODE_MENTION_REGEX =
  /@\[(?<bracket>[^\]]+)\]|@(?<plain>[^\s@，。！？；;：:,]+)(?!\s*[：:])/gu

/** 匹配 `@[标题](uuid)`；必须写在无 id 的 `@[标题]` 之前，避免截断 */
const MENTION_WITH_ID_REGEX =
  /@\[(?<t1>[^\]]+)\]\((?<tid>[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})\)/gu

/** 无 id 的 `@[标题]`（不与上面重叠：上面已消费带括号的 uuid） */
const MENTION_BRACKET_ONLY_REGEX = /@\[(?<t2>[^\]]+)\]/gu

/** 无空格、无 id 的 `@词`（排除 `@[` 以免与括号形式冲突） */
const MENTION_PLAIN_REGEX = /@(?!\[)(?<plain>[^\s@，。！？；;：:,]+)(?!\s*[：:])/gu

/**
 * 单次解析出的 @ 引用片段。
 */
export type ParsedMentionRef = {
  start: number
  end: number
  /** 存在时唯一绑定画布节点，重命名标题不影响解析 */
  nodeId?: string
  /** 展示/旧数据：无 id 时与节点标题全等匹配 */
  label: string
}

/**
 * 从全文解析所有 @ 引用（含 `@[标题](id)`），按出现顺序且不重叠。
 */
export function parseMentionRefs(text: string): ParsedMentionRef[] {
  const out: ParsedMentionRef[] = []
  const used = new Set<number>()
  const push = (start: number, end: number, label: string, nodeId?: string) => {
    for (let p = start; p < end; p++) {
      if (used.has(p)) return
    }
    for (let p = start; p < end; p++) used.add(p)
    out.push({ start, end, label: label.trim(), nodeId })
  }

  for (const m of text.matchAll(MENTION_WITH_ID_REGEX)) {
    const g = m.groups as { t1?: string; tid?: string }
    if (g.t1 != null && g.tid) {
      const start = m.index ?? 0
      push(start, start + m[0].length, g.t1, g.tid.trim())
    }
  }

  for (const m of text.matchAll(MENTION_BRACKET_ONLY_REGEX)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (used.has(start)) continue
    const g = m.groups as { t2?: string }
    if (g.t2 == null) continue
    let overlap = false
    for (let p = start; p < end; p++) {
      if (used.has(p)) {
        overlap = true
        break
      }
    }
    if (overlap) continue
    push(start, end, g.t2)
  }

  for (const m of text.matchAll(MENTION_PLAIN_REGEX)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    let overlap = false
    for (let p = start; p < end; p++) {
      if (used.has(p)) {
        overlap = true
        break
      }
    }
    if (overlap) continue
    const g = m.groups as { plain?: string }
    if (g.plain == null) continue
    push(start, end, g.plain)
  }

  return out.sort((a, b) => a.start - b.start)
}

/**
 * 写入提示/正文时使用的稳定引用：`@[标题](节点id)`。标题变更不影响解析。
 */
export function buildMentionToken(title: string, nodeId: string): string {
  const t = title.trim()
  return `@[${t}](${nodeId})`
}

/**
 * 重写文本中带 id 的引用 `@[标题](uuid)` 的「标题」部分，使其与当前节点标题一致。
 * - 仅处理带 `nodeId` 的引用，避免误改旧语法 `@[标题]` / `@词`；
 * - 标题不同才改写，尽量保持原文不动；
 */
export function refreshMentionLabelsInText(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
): { text: string; changed: boolean } {
  const raw = String(text ?? '')
  if (!raw.includes('@[') || !raw.includes(')')) return { text: raw, changed: false }
  const refs = parseMentionRefs(raw)
  if (!refs.length) return { text: raw, changed: false }

  const titleById = new Map<string, string>()
  for (const n of nodes) {
    const id = String(n.id || '').trim()
    if (!id) continue
    titleById.set(id, String((n.data as StudioNodeData)?.title ?? n.data?.title ?? '').trim())
  }

  let next = raw
  let changed = false
  // 从后往前替换，避免索引偏移
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    const ref = refs[i]
    const nodeId = String(ref.nodeId || '').trim()
    if (!nodeId) continue
    const latestTitle = String(titleById.get(nodeId) || '').trim()
    if (!latestTitle) continue
    if (latestTitle === String(ref.label || '').trim()) continue
    const token = buildMentionToken(latestTitle, nodeId)
    next = `${next.slice(0, ref.start)}${token}${next.slice(ref.end)}`
    changed = true
  }

  return { text: next, changed }
}

/**
 * 文本中是否已包含对某节点的 @ 引用（按 id 判断）。
 */
export function mentionAlreadyReferencesNodeId(text: string, nodeId: string): boolean {
  return parseMentionRefs(text).some((r) => r.nodeId === nodeId)
}

/** 可作为「图片输入 / 参考图缩略图」链路的 @ 目标：仅静态图与全景（视频/音频走各自管线） */
function isImagePipelineMentionKind(kind: StudioNodeData['kind']): boolean {
  return kind === 'image' || kind === 'panorama'
}

/**
 * 与画布默认标题「{类型标签}节点N」一致的前缀（须与 `StudioApp` 内 `NODE_KIND_LABEL` 文案保持同步）。
 */
const DEFAULT_NODE_TITLE_INDEX_PREFIXES: readonly string[] = [
  '文字节点',
  '剧本节点',
  '图片节点',
  '视频节点',
  '音频节点',
  '音乐节点',
  'VR360全景节点',
]

/**
 * 解析默认命名标题中的序号 N；非「某类型节点N」形态则返回 `null`。
 *
 * @param title 节点标题
 * @returns 正整数序号，无法解析时返回 `null`
 */
export function parseDefaultNodeTitleIndex(title: string): number | null {
  const t = String(title ?? '').trim()
  for (const prefix of DEFAULT_NODE_TITLE_INDEX_PREFIXES) {
    if (!t.startsWith(prefix)) continue
    const rest = t.slice(prefix.length).trim()
    const m = /^(\d+)/u.exec(rest)
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

type ResolvedVisualMentionWithUrl = {
  ref: ParsedMentionRef
  node: Node<StudioNodeData>
  url: string
}

/**
 * 按默认标题中的序号升序排列；无序号标题排在有序号之后，同组内按原文中 `@` 出现位置。
 */
export function sortMentionsByDefaultTitleIndex<
  T extends { ref: ParsedMentionRef; node: Node<StudioNodeData> },
>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const ia = parseDefaultNodeTitleIndex(String(a.node.data.title ?? ''))
    const ib = parseDefaultNodeTitleIndex(String(b.node.data.title ?? ''))
    const hasA = ia != null
    const hasB = ib != null
    if (hasA && hasB && ia !== ib) return (ia as number) - (ib as number)
    if (hasA && !hasB) return -1
    if (!hasA && hasB) return 1
    return a.ref.start - b.ref.start
  })
}

/**
 * 解析文本中可产出媒体 URL 的 @ 引用条目（未排序）。
 */
function collectResolvedVisualMentionsWithUrl(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
): ResolvedVisualMentionWithUrl[] {
  const refs = parseMentionRefs(text)
  const out: ResolvedVisualMentionWithUrl[] = []
  for (const ref of refs) {
    const hit = resolveMentionRefToNode(ref, nodes, currentNodeId, isImagePipelineMentionKind)
    if (!hit) continue
    const kind = hit.data.kind
    if (kind === 'panorama') {
      const d = hit.data as PanoramaNodeData
      const u = String(d.rectilinearSrc || d.src || '').trim()
      if (u) out.push({ ref, node: hit, url: u })
      continue
    }
    const d = hit.data as ImageNodeData
    const src = String(d.src || '').trim()
    const refsList = d.referenceImageSources?.filter(Boolean) ?? []
    const url = src || refsList[0]
    if (url) out.push({ ref, node: hit, url })
  }
  return out
}

/**
 * 将一条解析结果解析为画布节点；`kindFilter` 用于仅匹配含图/音媒体节点。
 */
export function resolveMentionRefToNode(
  ref: ParsedMentionRef,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
  kindFilter?: (kind: StudioNodeData['kind']) => boolean,
): Node<StudioNodeData> | undefined {
  const nodeOk = (node: Node<StudioNodeData>) =>
    (!currentNodeId || node.id !== currentNodeId) && (!kindFilter || kindFilter(node.data.kind))

  if (ref.nodeId) {
    const hit = nodes.find((n) => n.id === ref.nodeId)
    if (hit && nodeOk(hit)) return hit
    return undefined
  }

  const titleToNode = new Map<string, Node<StudioNodeData>>()
  nodes.forEach((node) => {
    if (currentNodeId && node.id === currentNodeId) return
    const title = String(node.data.title || '').trim()
    if (!title) return
    if (!titleToNode.has(title)) titleToNode.set(title, node)
  })

  const exact = titleToNode.get(ref.label)
  if (exact && nodeOk(exact)) return exact

  const shorthand = ref.label.match(/^图[-\s]*(\d+)$/u)
  if (shorthand?.[1]) {
    const num = shorthand[1]
    const titled = titleToNode.get(`图片节点${num}`)
    if (titled && nodeOk(titled)) return titled
    return nodes.find((node) => {
      if (!nodeOk(node) || node.data.kind !== 'image') return false
      const t = String(node.data.title || '').trim()
      const m = /^图片节点(\d+)$/.exec(t)
      return m?.[1] === num
    })
  }

  return undefined
}

/**
 * 提取节点用于下游继承的主文本内容。
 */
export function getNodePrimaryText(data: StudioNodeData): string {
  if (data.kind === 'text' || data.kind === 'script') return data.body || ''
  if (data.kind === 'image' || data.kind === 'video') return data.prompt || ''
  if (data.kind === 'audio' || data.kind === 'music') return data.note || ''
  if (data.kind === 'panorama') return ''
  return ''
}

/**
 * 提取文本中 @ 引用的展示名列表（兼容旧 `collectMentionNames` 调用方）。
 */
export function collectMentionNames(text: string): string[] {
  return parseMentionRefs(text).map((r) => r.label)
}

/**
 * 从引用的节点中提取可作为「图片输入」的 URL（仅 @图片 / @全景；不含 @视频 / @音频）。
 * 优先使用节点主资源 src；若没有则回退到 referenceImageSources 首项。
 * 顺序按默认标题「某类型节点N」中 N 升序；无序号标题排在后面，同组内按原文 `@` 出现顺序。
 */
export function collectMentionImageSources(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
): string[] {
  const entries = collectResolvedVisualMentionsWithUrl(text, nodes, currentNodeId)
  const urls = entries.map((e) => e.url)
  return Array.from(new Set(urls))
}

export type MentionAudioResolvedEntry = { url: string; assetId: string }

/**
 * 从 @ 引用收集「配音 / 音乐」节点的主音频（原文出现顺序，按 URL 去重保序）。
 * 带上 `srcAssetId`，便于 `blob:` 失效后从本地资产恢复（与图片 @ 引用一致）。
 */
export function collectMentionAudioResolvedEntries(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
): MentionAudioResolvedEntry[] {
  const refs = parseMentionRefs(text)
  const out: MentionAudioResolvedEntry[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const hit = resolveMentionRefToNode(ref, nodes, currentNodeId)
    if (!hit) continue
    const k = hit.data.kind
    if (k !== 'audio' && k !== 'music') continue
    const u = String((hit.data as { src?: string }).src || '').trim()
    const assetId = String((hit.data as { srcAssetId?: string }).srcAssetId || '').trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push({ url: u, assetId })
  }
  return out
}

/**
 * 仅 URL 列表；内部走 `collectMentionAudioResolvedEntries`。
 */
export function collectMentionAudioSources(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
): string[] {
  return collectMentionAudioResolvedEntries(text, nodes, currentNodeId).map((e) => e.url)
}

/**
 * 侧栏说明用：描述里按出现顺序列出「会参与参考音」的 @（仅配音/音乐）；不含文字/剧本。
 */
export function listMentionAudioRefLabelsForNote(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
): string[] {
  const refs = parseMentionRefs(text)
  const out: string[] = []
  for (const ref of refs) {
    const hit = resolveMentionRefToNode(ref, nodes, currentNodeId)
    if (!hit) continue
    if (hit.data.kind !== 'audio' && hit.data.kind !== 'music') continue
    const title = String(hit.data.title || '').trim()
    const lab = String(ref.label || '').trim()
    out.push(lab || title || '未命名配音节点')
  }
  return out
}

/**
 * 列出提示词中 @ 引用且解析为「图片/全景 URL」的条目，供提示框展示缩略图。
 * 顺序与 `collectMentionImageSources` 一致：默认标题序号升序，其余按原文出现顺序。
 */
export function listMentionImageAttachments(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
): Array<{ mention: string; url: string }> {
  const entries = collectResolvedVisualMentionsWithUrl(text, nodes, currentNodeId)
  return entries.map((e) => ({
    mention: text.slice(e.ref.start, e.ref.end),
    url: e.url,
  }))
}

/**
 * 解析文本中的 @节点引用并替换为对应节点主文本。
 * 若引用的是图片/视频/配音/音乐节点：仅表示沿用其**生成结果（画面/音频 URL）**，
 * 由 `collectMentionImageSources` / `collectMentionAudioSources` 等在执行前单独并入节点字段，此处不把该节点的提示词/说明写进文案。
 */
export function resolveNodeMentionsInText(
  text: string,
  nodes: Array<Node<StudioNodeData>>,
  currentNodeId?: string,
): string {
  if (!text.includes('@')) return text
  const refs = parseMentionRefs(text)
  if (!refs.length) return text
  let out = text
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]
    const hit = resolveMentionRefToNode(ref, nodes, currentNodeId)
    if (!hit) {
      continue
    }
    const kind = hit.data.kind
    const replacement =
      kind === 'image' ||
      kind === 'video' ||
      kind === 'audio' ||
      kind === 'music' ||
      kind === 'panorama'
        ? ''
        : getNodePrimaryText(hit.data).trim() || ''
    out = out.slice(0, ref.start) + replacement + out.slice(ref.end)
  }
  return out
}
